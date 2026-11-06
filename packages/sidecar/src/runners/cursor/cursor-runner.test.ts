/**
 * @feature AGENT-09 Cursor: SDK in process (runner)
 * Owns: tests for the Cursor runner: capabilities, detection through the SDK, the static model list,
 * no slash commands, the user's MCP files and the per-workspace run store.
 * Test first: capabilities.resumeAt is false and slashCommands is false.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionConfig } from "@conducted/protocol";
import {
	appError,
	cryptoIds,
	err,
	ok,
	type SessionId,
	systemClock,
	type WorkspaceId,
} from "@conducted/shared";
import { createLogger, type LogRecord } from "../../logging/logger.ts";
import { composeSidecar, type SidecarPorts } from "../../modes/sidecar-mode.ts";
import { KeyedSerialQueue } from "../../session/serial-queue.ts";
import { FakeCursorRun, FakeCursorSdk } from "../../test-support/cursor-fakes.ts";
import { FakeApp } from "../../test-support/fake-app.ts";
import { MemoryStorage } from "../../test-support/memory-storage.ts";
import { createDeferred } from "../../util/deferred.ts";
import type { StartOptions, TurnCallbacks, TurnInput } from "../runner.ts";
import {
	CURSOR_MODELS,
	CursorRunner,
	type CursorRunnerDeps,
	cursorStoreFolder,
	expandCursorEnv,
	readCursorMcpServers,
} from "./cursor-runner.ts";
import type { CursorSdk } from "./cursor-sdk.ts";
import { EnvLock } from "./env-lock.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function folder(prefix: string): Promise<string> {
	const made = await mkdtemp(path.join(tmpdir(), prefix));
	cleanups.push(() => rm(made, { recursive: true, force: true }));
	return made;
}

const slot = (inner: string): string => `\${${inner}}`;

const baseConfig: SessionConfig = {
	agent: "cursor",
	model: "cursor-composer-2-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

function startOptions(env: Record<string, string>, workspacePath: string): StartOptions {
	return {
		sessionId: "session-1" as SessionId,
		config: baseConfig,
		workspace: {
			workspaceId: "workspace-1" as WorkspaceId,
			workspaceName: "one",
			workspacePath,
			repoRootPath: "/repo",
			targetBranch: "origin/main",
			placeholderBranch: false,
			port: 4310,
		},
		env,
	};
}

function logger(records: LogRecord[] = []) {
	return createLogger({
		sink: (record) => records.push(record),
		clock: systemClock,
		level: "debug",
		scope: "test:cursor-runner",
	});
}

function runner(
	sdk: CursorSdk | null,
	records: LogRecord[] = [],
	target: Record<string, string | undefined> = {},
): CursorRunner {
	const deps: CursorRunnerDeps = {
		logger: logger(records),
		clock: systemClock,
		ids: cryptoIds,
		probe: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
		findExecutable: async () => null,
		loadSdk: async () =>
			sdk === null
				? { ok: false, error: { code: "cursor_sdk_missing", message: "No SDK." } }
				: ok(sdk),
		envLock: new EnvLock({ queue: new KeyedSerialQueue(), target }),
	};
	return new CursorRunner(deps);
}

const callbacks = (): TurnCallbacks => ({
	onMessage: () => {},
	requestInteraction: async () => ({ kind: "withdrawn" }),
	onAgentSessionId: () => {},
	onBackgroundTasks: () => {},
	beforeFirstWrite: async () => {},
	onFastModeUnavailable: () => {},
});

const turnInput = (): TurnInput => ({ text: "hello", attachmentPaths: [], config: baseConfig });

describe("AGENT-09 Cursor runner", () => {
	test("resumeAt and slash commands are off, while steer and interrupt are on", () => {
		const subject = runner(new FakeCursorSdk());
		expect(subject.agent).toBe("cursor");
		expect(subject.capabilities.resumeAt).toBe(false);
		expect(subject.capabilities.slashCommands).toBe(false);
		expect(subject.capabilities.mcpServers).toBe(false);
		expect(subject.capabilities.contextUsage).toBe(false);
		expect(subject.capabilities.steer).toBe(true);
		expect(subject.capabilities.interrupt).toBe(true);
	});

	test("detect reports the SDK it can load, and null when it cannot", async () => {
		expect(await runner(new FakeCursorSdk()).detect({})).toEqual({
			path: "@cursor/sdk",
			version: "",
		});
		expect(await runner(null).detect({})).toBeNull();
	});

	test("the model catalog is static and has one default", async () => {
		const models = await runner(new FakeCursorSdk()).listModels();
		expect(models).toEqual(CURSOR_MODELS.map((model) => ({ ...model })));
		expect(models.filter((model) => model.isDefault)).toHaveLength(1);
		expect(models.every((model) => model.efforts.length > 0)).toBe(true);
	});

	test("there are no slash commands and no MCP listing", async () => {
		const subject = runner(new FakeCursorSdk());
		expect(await subject.listSlashCommands("/workspace")).toEqual([]);
		expect("listMcpServers" in subject).toBe(false);
	});

	test("the narrow SDK interface does not import the Cursor package", () => {
		const source = readFileSync(path.join(import.meta.dir, "cursor-sdk.ts"), "utf8");
		expect(source).not.toMatch(/\bfrom\s+["']@cursor\/sdk["']/);
		expect(source).not.toMatch(/\bimport\s*\(\s*["']@cursor\/sdk["']/);
	});

	test("a workspace gets its own run store folder under the root", () => {
		const one = cursorStoreFolder("/app-data", "/workspaces/one");
		const two = cursorStoreFolder("/app-data", "/workspaces/two");
		expect(one).not.toBe(two);
		expect(one.startsWith(path.join("/app-data", "cursor-sdk-store"))).toBe(true);
		expect(path.basename(one)).toMatch(/^[0-9a-f]{16}$/);
	});

	test("environment placeholders are filled and other values are kept", () => {
		const expanded = expandCursorEnv(
			{
				command: slot("BIN"),
				args: ["--token", slot("env:TOKEN")],
				url: `${slot("MISSING:-https://fallback.test")}/mcp`,
				count: 3,
				on: true,
			},
			{ BIN: "node", TOKEN: "secret", MISSING: "" },
		);
		expect(expanded).toEqual({
			command: "node",
			args: ["--token", "secret"],
			url: "https://fallback.test/mcp",
			count: 3,
			on: true,
		});
	});

	test("the user and workspace MCP files merge, invalid servers drop and remote fields stay", async () => {
		const home = await folder("cursor-home-");
		const workspace = await folder("cursor-workspace-");
		await mkdir(path.join(home, ".cursor"), { recursive: true });
		await mkdir(path.join(workspace, ".cursor"), { recursive: true });
		await writeFile(
			path.join(home, ".cursor", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					local: { command: "node", args: [slot("TOKEN")] },
					remote: {
						url: "https://example.test/mcp",
						headers: { Authorization: `Bearer ${slot("env:TOKEN")}` },
						oauth: { clientId: "client", clientSecret: slot("TOKEN") },
						caBundlePath: "/certs/one.pem",
					},
					broken: { nope: true },
				},
			}),
		);
		await writeFile(
			path.join(workspace, ".cursor", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					local: { command: "deno" },
					extra: { url: `${slot("API_URL:-https://fallback.test")}/mcp` },
				},
			}),
		);
		const records: LogRecord[] = [];

		const servers = await readCursorMcpServers({
			home,
			workspacePath: workspace,
			env: { TOKEN: "secret", API_URL: "" },
			logger: logger(records),
		});

		expect(servers.local).toEqual({ command: "deno" });
		expect(servers.extra).toEqual({ url: "https://fallback.test/mcp" });
		expect(servers.remote).toEqual({
			url: "https://example.test/mcp",
			headers: { Authorization: "Bearer secret" },
			oauth: { clientId: "client", clientSecret: "secret" },
			caBundlePath: "/certs/one.pem",
		});
		expect(servers.broken).toBeUndefined();
		expect(
			records.some(
				(record) =>
					record.message.includes("Dropped a Cursor MCP server") &&
					(record.data?.server as string) === "broken",
			),
		).toBe(true);
	});

	test("a missing MCP file is fine and a broken one is skipped with a warning", async () => {
		const home = await folder("cursor-home-");
		const workspace = await folder("cursor-workspace-");
		await mkdir(path.join(workspace, ".cursor"), { recursive: true });
		await writeFile(path.join(workspace, ".cursor", "mcp.json"), "{ not json");
		const records: LogRecord[] = [];

		const servers = await readCursorMcpServers({
			home,
			workspacePath: workspace,
			env: {},
			logger: logger(records),
		});

		expect(servers).toEqual({});
		expect(records.some((record) => record.message.includes("not valid JSON"))).toBe(true);
	});

	test("start forwards the MCP servers and the per-workspace store to the SDK", async () => {
		const home = await folder("cursor-home-");
		const workspace = await folder("cursor-workspace-");
		await mkdir(path.join(workspace, ".cursor"), { recursive: true });
		await writeFile(
			path.join(workspace, ".cursor", "mcp.json"),
			JSON.stringify({ mcpServers: { local: { command: "node" } } }),
		);
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const root = await folder("cursor-store-");
		const previous = process.env.CONDUCTED_CURSOR_STORE_DIR;
		const ports: SidecarPorts = {
			app: new FakeApp(),
			query: (() => {
				throw new Error("No Claude query in this test");
			}) as unknown as SidecarPorts["query"],
			spawnCodex: async () => err(appError("codex_unavailable", "Not used")),
			spawnAcp: async () => err(appError("acp_unavailable", "Not used")),
			loadCursorSdk: async () => ok(sdk),
			probe: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
			findExecutable: async () => null,
			shellEnv: {
				get: async () =>
					ok({
						shell: "/bin/zsh",
						path: "/usr/bin",
						env: {},
						providerSecrets: {},
					}),
				refresh: async () =>
					ok({
						shell: "/bin/zsh",
						path: "/usr/bin",
						env: {},
						providerSecrets: {},
					}),
			},
			runCheckpointer: async () => ({ exitCode: 1, stdout: "", stderr: "not a repository" }),
			outboxStorage: new MemoryStorage(),
			makeTempDir: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
			readText: async () => ok(null),
			sidecarExecutable: "/bin/sidecar",
			hasTranscript: async () => false,
			newToken: () => "token",
			clock: systemClock,
			ids: cryptoIds,
			logger: logger(),
		};

		try {
			process.env.CONDUCTED_CURSOR_STORE_DIR = root;
			const host = composeSidecar(
				{
					binDir: root,
					outboxRoot: path.join(root, "outbox"),
					completionsDir: path.join(root, "completions"),
					logDir: path.join(root, "log"),
					appVersion: "0.0.0",
					logLevel: "info",
				},
				ports,
			);
			const found = host.runners.get({ agent: "cursor" });
			expect(found.ok).toBe(true);
			if (!found.ok) throw new Error(found.error.message);
			const session = await found.value.start(
				startOptions({ HOME: home, CURSOR_API_KEY: "cursor-key" }, workspace),
			);
			const expected = cursorStoreFolder(root, workspace);
			const resumed = createDeferred<void>();
			sdk.onResume = () => {
				expect(process.env.CONDUCTED_CURSOR_STORE_DIR).toBe(expected);
				resumed.resolve();
			};
			const outcome = session.runTurn(turnInput(), callbacks());
			await resumed.promise;
			await session.cancel();
			expect(await outcome).toEqual({ kind: "cancelled" });

			expect(sdk.resumeCalls[0]?.options.mcpServers).toEqual({
				local: { command: "node" },
			});
			expect(sdk.resumeCalls[0]?.options.local.storeDir).toBe(expected);
		} finally {
			if (previous === undefined) delete process.env.CONDUCTED_CURSOR_STORE_DIR;
			else process.env.CONDUCTED_CURSOR_STORE_DIR = previous;
		}
	});
});
