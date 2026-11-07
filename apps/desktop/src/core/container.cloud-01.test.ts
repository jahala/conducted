// @vitest-environment node
/**
 * @feature CLOUD-01 Host interface: each workspace reaches git, shell, files, terminals and its sidecar through a local or cloud host
 * Owns: the composition-root proof that a workspace's git, shell, file, terminal and chat calls
 * check its host first: a local workspace's calls run on the Mac as before, and a cloud
 * workspace's calls stop at the placeholder of the row that owns that cloud door, with nothing run
 * on the Mac in its place.
 * Behaviour: services-map.md 1.2 (shell, file and git calls take a host and check it before use),
 * frontend.md 3c (the query options carry the host).
 * Test first: a cloud workspace's calls stop at the host check, and nothing runs on the Mac.
 */
import type { Host, SessionConfig } from "@conducted/protocol";
import { NotImplemented, ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";
import type { Workspace } from "./model.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const CLOUD: Host = { kind: "cloud", url: "https://conducted.example.workers.dev", vmId: "vm-1" };

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** The backlog id of the placeholder a call stopped at, or what it did instead. */
async function stoppedAt(call: () => Promise<unknown>): Promise<string> {
	try {
		return `went on: ${JSON.stringify(await call())}`;
	} catch (cause) {
		return cause instanceof NotImplemented ? cause.featureId : `threw: ${String(cause)}`;
	}
}

/** A ready workspace on `host` whose folder exists, with one file in it. */
async function readyWorkspace(test: TestContainer, host: Host): Promise<Workspace> {
	const workspace = await seedWorkspace(test.container, { host });
	await test.container.platform.fs.mkdirp(workspace.path);
	test.memory.controls.files.set(`${workspace.path}/README.md`, "hello\n");
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await test.container.services.workspace.start();
	// Git answers with nothing to report, so a call that reaches the Mac succeeds. A cloud repo's
	// config read fetches its shared clone's branch (CLOUD-04), and that is a Mac git call.
	test.memory.controls.scriptShell((command) =>
		command.program === "git" ? ok({ stdout: "", stderr: "", exitCode: 0 }) : null,
	);
	must(await test.container.services.repo.loadConfig(workspace.repoId));
	return workspace;
}

/** Answers every sendMessage at once and keeps the workspace each one carried. */
function captureSends(test: TestContainer): { hosts: unknown[] } {
	const transport = test.memory.platform.sidecar;
	const originalSend = transport.send.bind(transport);
	const hosts: unknown[] = [];
	transport.send = async (line) => {
		const answered = await originalSend(line);
		const parsed = JSON.parse(line) as {
			id: number;
			method: string;
			params: { workspace?: { host?: unknown } };
		};
		if (parsed.method === "sendMessage") {
			hosts.push(parsed.params.workspace?.host);
			queueMicrotask(() =>
				test.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { deliveredAs: "new_turn" } }),
				),
			);
		}
		return answered;
	};
	return { hosts };
}

const ranIn = (test: TestContainer, folder: string): number =>
	test.memory.controls.shellCalls.filter((call) => call.cwd?.startsWith(folder) === true).length;

describe("CLOUD-01 the host seam in the real container", () => {
	it("a local workspace's git, shell, file, terminal and chat calls run on the Mac", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			const workspace = await readyWorkspace(test, { kind: "local" });
			expect(workspace.host).toEqual({ kind: "local" });

			expect((await test.container.services.git.refresh(workspace.id, "full")).ok).toBe(true);
			expect(ranIn(test, workspace.path)).toBeGreaterThan(0);

			const file = await test.container.services.workspaceFiles.readFile(workspace.id, "README.md");
			expect(file.ok && file.value.text).toBe("hello\n");

			must(await test.container.services.terminals.create(workspace.id));
			must(await test.container.services.terminals.runCommand(workspace.id, "echo hi"));
			expect(test.memory.controls.ptySpawns.map((spawn) => spawn.cwd)).toEqual([
				workspace.path,
				workspace.path,
			]);

			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));
			expect(sends.hosts).toEqual([{ kind: "local" }]);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});

	it("a cloud workspace's calls stop at the host check, and nothing runs on the Mac", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			const workspace = await readyWorkspace(test, CLOUD);
			expect(workspace.host).toEqual(CLOUD);
			const services = test.container.services;

			// Git, shell and files go through the user's Worker, and a chat through its relay
			// (CLOUD-03); terminals and run commands through the cloud runtime (CLOUD-09).
			expect(await stoppedAt(() => services.git.refresh(workspace.id, "full"))).toBe("CLOUD-03");
			expect(
				await stoppedAt(() => services.workspaceFiles.readFile(workspace.id, "README.md")),
			).toBe("CLOUD-03");
			expect(await stoppedAt(() => services.terminals.create(workspace.id))).toBe("CLOUD-09");
			expect(await stoppedAt(() => services.terminals.runCommand(workspace.id, "echo hi"))).toBe(
				"CLOUD-09",
			);
			const session = must(await services.sessions.create(workspace.id, CONFIG));
			expect(await stoppedAt(() => services.sessions.send(session.id, "hello", [], "auto"))).toBe(
				"CLOUD-03",
			);
			// The workspace's own lifecycle touches its folder too.
			expect(await stoppedAt(() => services.workspace.retrySetup(workspace.id))).toBe("CLOUD-03");
			expect(await stoppedAt(() => services.workspace.openIn(workspace.id, "Finder"))).toBe(
				"CLOUD-03",
			);
			expect(
				await stoppedAt(() => services.workspace.archive(workspace.id, { deleteBranch: false })),
			).toBe("CLOUD-03");
			expect(await stoppedAt(() => services.workspace.remove(workspace.id))).toBe("CLOUD-03");

			expect(ranIn(test, workspace.path)).toBe(0);
			expect(test.memory.controls.ptySpawns).toEqual([]);
			expect(sends.hosts).toEqual([]);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
});
