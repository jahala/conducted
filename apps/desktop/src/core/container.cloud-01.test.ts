// @vitest-environment node
/**
 * @feature CLOUD-01 Host interface: each workspace reaches git, shell, files, terminals and its sidecar through a local or cloud host
 * Owns: the composition-root proof that a workspace's git, shell, file, terminal and chat calls
 * check its host first: a local workspace's calls run on the Mac as before, and a cloud
 * workspace's git, file, chat and terminal calls reach the Worker and its relay, with nothing run
 * on the Mac in its place.
 * Behaviour: services-map.md 1.2 (shell, file and git calls take a host and check it before use),
 * frontend.md 3c (the query options carry the host).
 * Test first: a cloud workspace's git, file and chat calls reach the Worker, and nothing runs on
 * the Mac in their place.
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

	it("a cloud workspace's git, file, shell and chat calls reach the Worker, and terminals stop at CLOUD-09", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			const workspace = await readyWorkspace(test, CLOUD);
			expect(workspace.host).toEqual(CLOUD);
			const services = test.container.services;
			const cloud = test.memory.controls;
			cloud.scriptCloud((request) => {
				if (request.path === "/w/vm-1/git") {
					const args = (request.body as { args?: string[] }).args ?? [];
					// An archive reads the branch's head through this same route.
					const stdout = args.includes("rev-parse") && args.includes("HEAD") ? "abc123\n" : "";
					return ok({
						status: 200,
						body: JSON.stringify({ exitCode: 0, stdout, stderr: "" }),
					});
				}
				if (request.path === "/w/vm-1/stop") {
					return ok({
						status: 200,
						body: JSON.stringify({ running: false, ran: true, saved: [], skipped: [] }),
					});
				}
				if (request.path === "/w/vm-1/remove") {
					return ok({ status: 200, body: JSON.stringify({ deletedBackups: 0 }) });
				}
				if (request.path === "/w/vm-1/exec") {
					return ok({
						status: 200,
						body: JSON.stringify({ exitCode: 0, stdout: "", stderr: "" }),
					});
				}
				if (request.path === "/w/vm-1/files") {
					const body = request.body as { operation?: string; path?: string };
					switch (body.operation) {
						case "read":
							return ok({ status: 200, body: JSON.stringify({ text: "hello\n" }) });
						case "exists":
							return ok({ status: 200, body: JSON.stringify({ exists: true }) });
						case "stat":
							return ok({
								status: 200,
								body: JSON.stringify({
									stat: {
										path: body.path ?? "/",
										isDirectory: false,
										isSymlink: false,
										size: 6,
										modifiedAt: 0,
									},
								}),
							});
						case "readDir":
							return ok({ status: 200, body: JSON.stringify({ entries: [] }) });
						default:
							return ok({ status: 200, body: "{}" });
					}
				}
				return null;
			});

			// Git, files, a chat and terminals go through the user's Worker (CLOUD-03, CLOUD-09).
			expect((await services.git.refresh(workspace.id, "full")).ok).toBe(true);
			expect(cloud.cloudRequests.some((request) => request.path === "/w/vm-1/git")).toBe(true);

			const file = await services.workspaceFiles.readFile(workspace.id, "README.md");
			expect(file.ok && file.value.text).toBe("hello\n");
			expect(
				cloud.cloudRequests.some(
					(request) =>
						request.path === "/w/vm-1/files" &&
						(request.body as { operation?: string }).operation === "read",
				),
			).toBe(true);

			must(await services.terminals.create(workspace.id));
			must(await services.terminals.runCommand(workspace.id, "echo hi"));
			expect(
				Object.values(cloud.cloudRelayChannels).filter((channel) => channel === "terminal"),
			).toHaveLength(2);
			expect(cloud.ptySpawns).toHaveLength(0);

			// The doors the cloud rows do not own stop at their own row, before anything reaches the
			// Mac: file search at CLOUD-11 and Open in at CLOUD-12.
			const shells = cloud.shellCalls.length;
			const ptys = cloud.ptySpawns.length;
			const filesOnDisk = new Map(cloud.files);
			expect(await stoppedAt(() => services.workspaceFiles.tree(workspace.id))).toBe("CLOUD-11");
			expect(
				await stoppedAt(() => services.workspaceFiles.quickOpen(workspace.id, "read", 10)),
			).toBe("CLOUD-11");
			expect(
				await stoppedAt(() =>
					services.workspaceFiles.grep(workspace.id, "hello", {
						caseSensitive: false,
						wholeWord: false,
						regex: false,
					}),
				),
			).toBe("CLOUD-11");
			expect(await stoppedAt(() => services.workspace.openIn(workspace.id, "Finder"))).toBe(
				"CLOUD-12",
			);

			const session = must(await services.sessions.create(workspace.id, CONFIG));
			const sending = services.sessions.send(session.id, "hello", [], "auto");
			const line = await waitForSent(cloud, "sendMessage");
			const parsed = JSON.parse(line.line) as {
				id: number;
				params: {
					workspace: { host: unknown };
					launch: { providerKeys: Record<string, { value: string }> };
				};
			};
			expect(parsed.params.workspace.host).toEqual(CLOUD);
			// A key the Keychain does not hold is absent, and no key reaches the sandbox anyway
			// (CLOUD-05 swaps the placeholder; router.test.ts holds the non-empty case).
			expect(parsed.params.launch.providerKeys).toEqual({});
			cloud.emitCloudLine(
				line.relayId,
				`${JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { deliveredAs: "new_turn" } })}\n`,
			);
			expect((await sending).ok).toBe(true);

			expect(ranIn(test, workspace.path)).toBe(0);
			expect(test.memory.controls.ptySpawns).toEqual([]);
			expect(sends.hosts).toEqual([]);

			// Lifecycle is built (CLOUD-08): archive saves and stops the sandbox, unarchive moves the
			// row back, and delete removes what the Worker keeps.
			must(await services.workspace.archive(workspace.id, { deleteBranch: false }));
			expect(cloud.cloudRequests.some((request) => request.path === "/w/vm-1/stop")).toBe(true);
			expect(services.workspace.store.getState().workspacesById[workspace.id]?.state).toBe(
				"archived",
			);
			must(
				await services.workspace.unarchive(workspace.id, {
					branchName: null,
					clearChats: false,
				}),
			);
			expect(services.workspace.store.getState().workspacesById[workspace.id]?.state).toBe("ready");
			must(await services.workspace.remove(workspace.id));
			expect(cloud.cloudRequests.some((request) => request.path === "/w/vm-1/remove")).toBe(true);
			expect(services.workspace.store.getState().workspacesById[workspace.id]).toBeUndefined();
			expect(cloud.shellCalls.length).toBe(shells);
			expect(cloud.ptySpawns.length).toBe(ptys);
			expect(new Map(cloud.files)).toEqual(filesOnDisk);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
});

/** Waits for the app to send `method` on a cloud relay; the bound is a hang guard, not a delay. */
async function waitForSent(
	controls: { readonly cloudSent: readonly { relayId: string; line: string }[] },
	method: string,
): Promise<{ relayId: string; line: string }> {
	for (let attempt = 0; attempt < 500; attempt++) {
		const found = controls.cloudSent.find((sent) => sent.line.includes(`"${method}"`));
		if (found !== undefined) return found;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`the app never sent ${method} on a cloud relay`);
}
