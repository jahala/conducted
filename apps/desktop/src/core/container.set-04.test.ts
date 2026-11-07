/**
 * @feature SET-04 Environment variables, stored in the Keychain
 * Owns: proof that the real composition root loads a workspace's dotenv files into a chat's
 * agent launch, in Conductor's order: the user's layer first, then the repository's shared and
 * local layers, with a repository file's value beating a saved variable of the same name.
 * Behaviour: services-map.md 4.2.4 (environment_variable_files, dotenv parsing and path
 * resolution) and 4.2.8 (the read merge: stored rows, then file layers).
 * Test first: loads a repository's env file and lets its value beat a saved variable of the same name.
 * Our design choice: env-file values are never written to a log line; the test reads the memory
 * platform's log, which keeps each message without its data.
 */
import type { SessionConfig } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";

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

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

interface SentLine {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params: {
		launch?: { env: Record<string, string> };
	};
}

/** Answers every sendMessage at once and keeps the last one the container sent. */
function captureSends(test: TestContainer): { last(): SentLine | null } {
	const transport = test.memory.platform.sidecar;
	const originalSend = transport.send.bind(transport);
	let sent: SentLine | null = null;
	transport.send = async (line) => {
		const answered = await originalSend(line);
		const parsed = JSON.parse(line) as SentLine;
		if (parsed.method === "sendMessage") {
			sent = parsed;
			queueMicrotask(() =>
				test.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { deliveredAs: "new_turn" } }),
				),
			);
		}
		return answered;
	};
	return { last: () => sent };
}

describe("SET-04 env files reach a chat's launch", () => {
	it("loads a repository's env file and lets its value beat a saved variable of the same name", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/set-04" });
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/set-04",
			});
			const settings = test.container.services.settings;
			must(await settings.start());
			test.memory.controls.files.set(
				"/code/projects/set-04/.env",
				"FROM_FILE=repo-file\nONLY_IN_FILE=file-only\n",
			);
			must(
				await settings.setForRepo(repo.rootPath, "environment_variable_files", [
					".env",
					"missing.env",
				]),
			);
			must(await settings.setEnvVar("FROM_FILE", "saved", "global"));
			must(await settings.setEnvVar("FROM_KEYCHAIN", "saved-only", "global"));
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));

			expect(sends.last()?.params.launch?.env).toMatchObject({
				FROM_FILE: "repo-file",
				ONLY_IN_FILE: "file-only",
				FROM_KEYCHAIN: "saved-only",
			});
			const messages = test.memory.controls.logs.map((line) => line.message).join("\n");
			expect(messages).not.toContain("repo-file");
			expect(messages).not.toContain("file-only");
			expect(messages).toContain("missing.env");
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("keeps a saved variable over the user's env file", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			const workspace = await seedWorkspace(test.container);
			const settings = test.container.services.settings;
			must(await settings.start());
			must(await settings.set("environment_variable_files", [".env"]));
			test.memory.controls.files.set(
				"/Users/conducted/.conducted/.env",
				"FROM_FILE=user-file\nONLY_IN_USER_FILE=user-only\n",
			);
			must(await settings.setEnvVar("FROM_FILE", "saved", "global"));
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));

			expect(sends.last()?.params.launch?.env).toMatchObject({
				FROM_FILE: "saved",
				ONLY_IN_USER_FILE: "user-only",
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("reads a cloud workspace's env files from its sandbox", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/cloud-set-04" });
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/sandbox/set-04",
				host: { kind: "cloud", url: "https://w.example.dev", vmId: "vm-1" },
			});
			test.memory.controls.scriptCloud((request) => {
				if (!request.path.endsWith("/files")) return null;
				const body = request.body as { operation?: string; path?: string };
				if (body.operation === "exists") {
					const exists =
						body.path === "/sandbox/set-04/.conducted/settings.local.toml" ||
						body.path === "/sandbox/set-04/.env";
					return ok({ status: 200, body: JSON.stringify({ exists }) });
				}
				if (body.operation !== "read") return null;
				if (body.path === "/sandbox/set-04/.conducted/settings.local.toml") {
					return ok({
						status: 200,
						body: JSON.stringify({ text: 'environment_variable_files = [".env"]\n' }),
					});
				}
				if (body.path === "/sandbox/set-04/.env") {
					return ok({
						status: 200,
						body: JSON.stringify({ text: "FROM_CLOUD_FILE=cloud-file\n" }),
					});
				}
				return null;
			});
			const settings = test.container.services.settings;
			must(await settings.start());
			must(await settings.setEnvVar("FROM_KEYCHAIN", "saved-only", "global"));

			const environment = must(
				await settings.environmentForLaunch(repo.id, workspace.path, workspace.path),
			);

			expect(environment).toMatchObject({
				FROM_CLOUD_FILE: "cloud-file",
				FROM_KEYCHAIN: "saved-only",
			});
			expect(
				test.memory.controls.cloudRequests.some((request) => request.path.endsWith("/files")),
			).toBe(true);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
