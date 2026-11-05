/**
 * @feature SIDE-13, SIDE-21, AGENT-16, AGENT-17 the s1-sidecar batch joined
 * Owns: one integration test per feature of the batch, driven through the session manager and the
 * handlers that the sidecar composition root builds. It proves that the options, the launch
 * settings, the ACP choices and the app tools bridge all reach the live path.
 * Behaviour: modes/sidecar-mode.ts (builds the manager and buildHandlers), runners/claude/options.ts,
 * runners/acp/acp-session.ts, runners/launch-env.ts, process/launch-fingerprint.ts, tools/socket-bridge.ts.
 * Test first: this file.
 * Our design choice: the runners are real and only their outside world is scripted, so a removed
 * wiring line fails here. The stand-ins come from test-support (FakeApp, FakeProcesses,
 * FakePublisher, FakeInteractions); the scripted SDK query and ACP agent are plain functions.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	AGENT_METHODS,
	agent as createAgentApp,
	ndJsonStream,
	type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
	AcpConfigOption,
	ModelInfo,
	SessionConfig,
	WorkspaceContext,
} from "@conducted/protocol";
import { cryptoIds, ok, type SessionId, systemClock, type WorkspaceId } from "@conducted/shared";
import { createLogger, type Logger } from "../logging/logger.ts";
import { buildHandlers, type HandlerDeps } from "../rpc/handlers.ts";
import type { AcpChild } from "../runners/acp/acp-client.ts";
import { AcpRunner } from "../runners/acp/acp-runner.ts";
import { ACP_ADAPTERS } from "../runners/acp/adapters/registry.ts";
import { ClaudeRunner } from "../runners/claude/claude-runner.ts";
import { ClaudeTranslator } from "../runners/claude/translate.ts";
import type { RunnerRegistry } from "../runners/registry.ts";
import { MapRunnerRegistry } from "../runners/registry.ts";
import { LiveStateStore } from "../session/live-state.ts";
import { DefaultSessionManager } from "../session/manager.ts";
import { KeyedSerialQueue } from "../session/serial-queue.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import { FakeInteractions } from "../test-support/fake-interactions.ts";
import { FakeProcesses } from "../test-support/fake-processes.ts";
import { FakePublisher } from "../test-support/fake-publisher.ts";
import { RpcAppToolBackend } from "../tools/backend.ts";
import { appToolsMcpEntry, BRIDGE_TOKEN_ENV } from "../tools/mcp-launch.ts";
import { callBridgeOverSocket } from "../tools/mcp-stdio-server.ts";
import { AppToolsBridge } from "../tools/socket-bridge.ts";
import { createScheduler, PARENT_PID_ENV } from "./sidecar-mode.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function workspaceFolder(): Promise<string> {
	const folder = await mkdtemp(path.join(tmpdir(), "conducted-s1-join-"));
	cleanups.push(() => rm(folder, { recursive: true, force: true }));
	return folder;
}

const MAIN = fileURLToPath(new URL("../main.ts", import.meta.url));
const BIN_DIR = fileURLToPath(new URL("../../../../bin", import.meta.url));

function workspaceFor(folder: string): WorkspaceContext {
	return {
		workspaceId: "workspace-1" as WorkspaceId,
		workspaceName: "join",
		workspacePath: folder,
		repoRootPath: folder,
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 5123,
	};
}

function baseConfig(over: Partial<SessionConfig> = {}): SessionConfig {
	return {
		agent: "claude",
		model: "sonnet",
		effort: "medium",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
		...over,
	};
}

function logger(): Logger {
	return createLogger({
		sink: () => {},
		clock: systemClock,
		level: "error",
		scope: "s1-sidecar-join",
	});
}

/** A handler either answers the result directly or wraps it in a Result. */
const unwrap = <T>(value: unknown): T => {
	if (typeof value === "object" && value !== null && "ok" in value) {
		const result = value as {
			ok: boolean;
			value?: unknown;
			error?: { message?: string };
		};
		if (!result.ok) throw new Error(result.error?.message ?? "The handler failed.");
		return result.value as T;
	}
	return value as T;
};

const model: ModelInfo = {
	id: "sonnet",
	label: "Sonnet",
	status: "picker",
	isNew: false,
	isDefault: true,
	efforts: [],
	defaultEffort: "medium",
	effortAxis: "effort",
	liveEffortChange: false,
	supportsFastMode: false,
};

interface Harness {
	manager: DefaultSessionManager;
	handlers: ReturnType<typeof buildHandlers>;
	app: FakeApp;
	processes: FakeProcesses;
	log: Logger;
}

/** The manager and handlers the sidecar composition root builds, with scripted agents. */
function harness(runners: RunnerRegistry): Harness {
	const app = new FakeApp();
	const log = logger();
	const processes = new FakeProcesses(systemClock);
	const publisher = new FakePublisher();
	const interactions = new FakeInteractions();
	const shellEnv = {
		get: async () => ok({ shell: "/bin/zsh", path: "/usr/bin", env: { PATH: "/usr/bin" } }),
		refresh: async () => ok({ shell: "/bin/zsh", path: "/usr/bin", env: { PATH: "/usr/bin" } }),
	};
	const manager = new DefaultSessionManager({
		app,
		runners,
		processes,
		checkpoints: {
			start: async () => ({}),
			end: async () => ({}),
		},
		prompt: { assemble: async (input) => ok(input.text) },
		shellEnv,
		publisher,
		liveState: new LiveStateStore({ app, flushed: async () => {} }),
		interactions,
		queue: new KeyedSerialQueue(),
		clock: systemClock,
		ids: cryptoIds,
		logger: log,
	});
	const deps: HandlerDeps = {
		sessions: manager,
		outbox: {
			open: async () => ok([]),
			append: async () => ok([]),
			acknowledge: async () => ok(undefined),
			pending: () => [],
			sessionsWithPending: () => [],
			sweepIdle: async () => ok(0),
		},
		models: {
			list: async () => ok([]),
			validate: async () => ok(model),
			invalidate: () => {},
		},
		agents: {
			detectAll: async () => [],
			startLogin: async () => ok({ loginId: "login-1", instructions: "Sign in" }),
			finishLogin: async () => ok({ outcome: "signed_in" }),
			cancelLogin: async () => ok(undefined),
		},
		slashCommands: { list: async () => ok([]) },
		mcpServers: { list: async () => ok([]) },
		usage: {
			contextUsage: async () => ok({ usedTokens: 0, windowTokens: 1, rateLimits: [] }),
		},
		shellEnv,
		utilityPrompt: { run: async () => ok({ text: "" }) },
		setLogLevel: () => {},
	};
	return { manager, handlers: buildHandlers(deps), app, processes, log };
}

/** A Claude SDK stream that stays open until the session is stopped. */
function scriptedQuery(
	captured: { options: Options }[],
): (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query {
	return (params) => {
		const options = params.options ?? {};
		captured.push({ options });
		const signal = options.abortController?.signal;
		return {
			async *[Symbol.asyncIterator]() {
				if (signal === undefined) return;
				await new Promise<void>((resolve) => {
					if (signal.aborted) resolve();
					else signal.addEventListener("abort", () => resolve(), { once: true });
				});
			},
			interrupt: async () => {},
			setModel: async () => {},
			setPermissionMode: async () => {},
			applyFlagSettings: async () => {},
			supportedModels: async () => [],
			supportedCommands: async () => [],
			mcpServerStatus: async () => [],
			getContextUsage: async () => ({ totalTokens: 0, maxTokens: 0 }),
			usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({}),
		} as unknown as Query;
	};
}

/** The options of the chat's own session, not the metadata query warmAgent runs first. */
const sessionOptions = (captured: { options: Options }[]): Options[] =>
	captured
		.map((entry) => entry.options)
		.filter((options) => options.env?.CONDUCTED_SESSION_ID !== undefined);

function claudeRunner(captured: { options: Options }[]): ClaudeRunner {
	const log = logger();
	return new ClaudeRunner({
		logger: log,
		clock: systemClock,
		ids: cryptoIds,
		probe: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
		findExecutable: async () => "/bin/claude",
		query: scriptedQuery(captured),
		appTools: new RpcAppToolBackend({
			app: new FakeApp(),
			interactions: new FakeInteractions(),
			logger: log,
		}),
		translator: () => new ClaudeTranslator({ logger: log }),
		hasTranscript: async () => false,
		realPath: async (target) => target,
		newUuid: () => randomUUID(),
		scheduler: createScheduler(),
		createCanUseTool: () => (async () => ({ behavior: "allow", updatedInput: {} })) as never,
		createMcpServers: () => ({}),
	});
}

function acpRunner(configOptions: SessionConfigOption[]): AcpRunner {
	const log = logger();
	const current = { options: configOptions };
	return new AcpRunner({
		logger: log,
		clock: systemClock,
		ids: cryptoIds,
		probe: async () => ok({ stdout: "1.18.18", stderr: "", exitCode: 0 }),
		findExecutable: async () => "/bin/opencode",
		adapter: ACP_ADAPTERS.opencode,
		spawn: async () => {
			const toAgent = new TransformStream<Uint8Array, Uint8Array>();
			const toChild = new TransformStream<Uint8Array, Uint8Array>();
			const app = createAgentApp({ name: "join" })
				.onRequest(AGENT_METHODS.initialize, () => ({
					protocolVersion: 1,
					agentCapabilities: { sessionCapabilities: { close: {} } },
					agentInfo: { name: "join", version: "1.18.18" },
				}))
				.onRequest(AGENT_METHODS.session_new, () => ({
					sessionId: "acp-session-1",
					configOptions: current.options,
				}))
				.onRequest(AGENT_METHODS.session_set_config_option, ({ params }) => {
					const value = (params as { value?: unknown }).value;
					const configId = (params as { configId?: string }).configId;
					current.options = current.options.map((option) => {
						if (option.id !== configId) return option;
						if (option.type === "boolean" && typeof value === "boolean") {
							return { ...option, currentValue: value };
						}
						if (option.type === "select" && typeof value === "string") {
							return { ...option, currentValue: value };
						}
						return option;
					});
					return { configOptions: current.options };
				})
				.onRequest(AGENT_METHODS.session_prompt, () => ({ stopReason: "end_turn" }))
				.onRequest(AGENT_METHODS.session_close, () => ({}));
			app.connect(ndJsonStream(toChild.writable, toAgent.readable));
			return ok({
				stdin: toAgent.writable,
				stdout: toChild.readable,
				onStderr: () => {},
				onExit: () => {},
				stop: async () => {},
			} satisfies AcpChild);
		},
	});
}

describe("s1-sidecar join the batch through the composition root", () => {
	test("AGENT-16 the chat's output style, effort and Chrome reach the Claude session", async () => {
		const folder = await workspaceFolder();
		const captured: { options: Options }[] = [];
		const h = harness(
			new MapRunnerRegistry([{ selector: { agent: "claude" }, runner: claudeRunner(captured) }]),
		);
		const config = baseConfig({
			effort: "ultra",
			fastMode: true,
			claudeOutputStyle: "concise",
			claudeInChrome: true,
		});
		try {
			await h.handlers.requests.warmAgent({
				sessionId: "session-1" as SessionId,
				config,
				workspace: workspaceFor(folder),
				launch: { env: {}, providerKeys: {} },
			});

			const options = sessionOptions(captured);
			expect(options).toHaveLength(1);
			expect(options[0]?.effort).toBe("max");
			expect(options[0]?.settings).toEqual({ outputStyle: "concise", fastMode: true });
			expect(options[0]?.extraArgs).toEqual({ chrome: null });
		} finally {
			await h.manager.shutdown("app_quit");
		}
	});

	test("AGENT-17 the ACP chat options are listed and set through the handlers", async () => {
		const folder = await workspaceFolder();
		const h = harness(
			new MapRunnerRegistry([
				{
					selector: { agent: "acp", acpAgent: "opencode" },
					runner: acpRunner([
						{
							type: "select",
							id: "model",
							name: "Model",
							category: "model",
							currentValue: "one",
							options: [
								{ value: "one", name: "One" },
								{ value: "two", name: "Two" },
							],
						},
						{
							type: "select",
							id: "thought_level",
							name: "Thought level",
							currentValue: "medium",
							options: [
								{ value: "low", name: "Low" },
								{ value: "medium", name: "Medium" },
								{ value: "high", name: "High" },
							],
						},
					]),
				},
			]),
		);
		const config = baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" });
		try {
			await h.handlers.requests.warmAgent({
				sessionId: "session-1" as SessionId,
				config,
				workspace: workspaceFor(folder),
				launch: { env: {}, providerKeys: {} },
			});

			const listed = unwrap<{ options: AcpConfigOption[] }>(
				await h.handlers.requests.listAcpConfigOptions({
					sessionId: "session-1" as SessionId,
				}),
			);
			expect(listed.options.map((option) => option.id)).toEqual(["thought_level"]);

			const changed = unwrap<{ options: AcpConfigOption[] }>(
				await h.handlers.requests.setAcpConfigOption({
					sessionId: "session-1" as SessionId,
					optionId: "thought_level",
					value: "high",
				}),
			);
			expect(changed.options[0]?.value).toEqual({
				kind: "select",
				current: "high",
				choices: [
					{ value: "low", name: "Low" },
					{ value: "medium", name: "Medium" },
					{ value: "high", name: "High" },
				],
			});
		} finally {
			await h.manager.shutdown("app_quit");
		}
	});

	test("SIDE-21 the launch's variables and own provider key fill the runner environment", async () => {
		const folder = await workspaceFolder();
		const captured: { options: Options }[] = [];
		const h = harness(
			new MapRunnerRegistry([{ selector: { agent: "claude" }, runner: claudeRunner(captured) }]),
		);
		try {
			await h.handlers.requests.warmAgent({
				sessionId: "session-1" as SessionId,
				config: baseConfig(),
				workspace: workspaceFor(folder),
				launch: {
					env: { FROM_THE_USER: "yes" },
					providerKeys: {
						ANTHROPIC_API_KEY: { value: "secret-anthropic", source: "entered" },
						OPENAI_API_KEY: { value: "secret-openai", source: "entered" },
					},
				},
			});

			const options = sessionOptions(captured);
			expect(options).toHaveLength(1);
			const env = options[0]?.env as Record<string, string>;
			expect(env.FROM_THE_USER).toBe("yes");
			expect(env.ANTHROPIC_API_KEY).toBe("secret-anthropic");
			expect(env.OPENAI_API_KEY).toBeUndefined();
			expect(env.CONDUCTED_SESSION_ID).toBe("session-1");
			expect(env.CONDUCTED_WORKSPACE_PATH).toBe(folder);
		} finally {
			await h.manager.shutdown("app_quit");
		}
	});

	test("SIDE-21 a changed launch restarts the idle agent with the new environment", async () => {
		const folder = await workspaceFolder();
		const captured: { options: Options }[] = [];
		const h = harness(
			new MapRunnerRegistry([{ selector: { agent: "claude" }, runner: claudeRunner(captured) }]),
		);
		const params = {
			sessionId: "session-1" as SessionId,
			config: baseConfig(),
			workspace: workspaceFor(folder),
			launch: {
				env: { SETTING_VALUE: "one" },
				providerKeys: {},
			},
		};
		try {
			await h.handlers.requests.warmAgent(params);
			await h.handlers.requests.warmAgent({
				...params,
				launch: { env: { SETTING_VALUE: "two" }, providerKeys: {} },
			});

			const options = sessionOptions(captured);
			expect(options).toHaveLength(2);
			expect(((options[0]?.env ?? {}) as Record<string, string>).SETTING_VALUE).toBe("one");
			expect(((options[1]?.env ?? {}) as Record<string, string>).SETTING_VALUE).toBe("two");
		} finally {
			await h.manager.shutdown("app_quit");
		}
	});

	test("SIDE-13 the helper's token reaches the bridge and an app tool answers", async () => {
		const folder = await workspaceFolder();
		const app = new FakeApp();
		app.reply = (method) =>
			method === "getWorkspaceDiff" ? ok({ diff: "the app's diff" }) : ok({});
		const bridge = new AppToolsBridge({
			backend: new RpcAppToolBackend({
				app,
				interactions: new FakeInteractions(),
				logger: logger(),
			}),
			tokens: { newToken: () => randomBytes(32).toString("base64url") },
			logger: logger(),
			makeTempDir: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
		});
		cleanups.push(() => bridge.stop());
		try {
			const started = await bridge.start();
			if (!started.ok) throw new Error(started.error.message);
			const sessionId = "session-1" as SessionId;
			const appTools = baseConfig().appTools;
			const token = bridge.registerSession(sessionId, appTools);
			const entry = appToolsMcpEntry({
				sidecarExecutable: process.execPath,
				sessionId,
				socketPath: started.value.socketPath,
				workspaceDir: folder,
				token,
				appTools,
			});

			expect(entry.args.join(" ")).not.toContain(token);
			expect(entry.env[BRIDGE_TOKEN_ENV]).toBe(token);

			const answered = await callBridgeOverSocket(
				started.value.socketPath,
				JSON.stringify({
					authToken: token,
					sessionId,
					toolName: "GetWorkspaceDiff",
					args: { statOnly: false },
				}),
			);
			const response = JSON.parse(answered) as {
				ok: boolean;
				text?: string;
				isError?: boolean;
			};
			expect(response).toEqual({ ok: true, text: "the app's diff", isError: false });
		} finally {
			await bridge.stop();
		}
	});

	test("SIDE-13 the real sidecar host starts its bridge folder and removes it on stop", async () => {
		const folder = await workspaceFolder();
		const home = path.join(folder, "home");
		await mkdir(home);
		const child: ChildProcess = spawn(process.execPath, [MAIN, "sidecar"], {
			env: {
				PATH: "/usr/bin:/bin",
				HOME: home,
				SHELL: "/bin/sh",
				TMPDIR: folder,
				CONDUCTED_BIN_DIR: BIN_DIR,
				CONDUCTED_OUTBOX_ROOT: path.join(folder, "outbox"),
				CONDUCTED_LOG_DIR: path.join(folder, "log"),
				[PARENT_PID_ENV]: String(process.pid),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		const exited = new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code) => resolve(code));
		});
		cleanups.push(async () => {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await exited.catch(() => {});
		});
		await new Promise<void>((resolve, reject) => {
			child.stdout?.on("data", () => {
				if (/^SOCKET_PATH=(.+)\n/m.test(stdout)) resolve();
			});
			child.once("error", reject);
			child.once("close", (code) => reject(new Error(`The host ended early (${code})`)));
		});

		expect((await readdir(folder)).some((name) => name.startsWith("cmcp-"))).toBe(true);

		child.kill("SIGTERM");
		expect(await exited).toBe(0);
		expect((await readdir(folder)).filter((name) => name.startsWith("cmcp-"))).toEqual([]);
	}, 30_000);
});
