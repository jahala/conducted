/**
 * @feature AGENT-09 Cursor: SDK in process
 * @feature AGENT-10 Cursor: translate to the neutral format
 * @feature AGENT-13 Codex goals: set, pause, resume, clear
 * @feature AGENT-14 Codex /compact
 * @feature AGENT-18 Bundled skill that teaches agents the app
 * @feature SIDE-13 App tools bridge
 * @feature SIDE-18 Sidecar logs go to the Rust shell's log files
 * @feature SIDE-21 Agent launch settings
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * @feature AGENT-16 Claude chat options
 * @feature AGENT-17 ACP chat options
 * @feature AGENT-15 Turns the Claude program starts by itself
 * @feature RC-02 Per-chat Remote Control switch and connection status
 * @feature RC-03 Accept input from claude.ai: messages, approvals, interrupts, with who sent each
 * Owns: the integration tests of the joined sidecar batches, driven through `composeSidecar`, the
 * function the sidecar's composition root (`startSidecarHost`) builds the host with, and through
 * `runSidecarMode`. They prove that the Cursor SDK and its translation, the Codex goals and compact
 * turn, the bundled skill plugin, the slash-command cache, the log settings, the chat options, the
 * launch settings, the app tools bridge, the turns Claude starts by itself and Remote Control (its
 * link, and messages typed on claude.ai) all reach the live path.
 * Behaviour: modes/sidecar-mode.ts (composeSidecar and the runner registry it builds),
 * runners/cursor/cursor-session.ts and translate.ts, runners/codex/goals.ts and codex-session.ts,
 * runners/claude/options.ts, runners/claude/skill-plugin.ts, models/completions-cache.ts,
 * runners/acp/acp-session.ts, runners/launch-env.ts, process/launch-fingerprint.ts,
 * tools/socket-bridge.ts, tools/mcp-launch.ts, runners/claude/self-started-turns.ts,
 * session/self-started-turns.ts, runners/claude/remote-control.ts and runners/claude/transcript.ts.
 * Test first: this file.
 * Our design choice: everything the composition root builds is real; only the outside world is
 * scripted through `SidecarPorts`: the Claude SDK's query, the Cursor SDK, the Codex and ACP child
 * processes, the program lookup, the login-shell capture, the checkpoint script and the file
 * reads. So a wiring line removed from the root fails here. The app is FakeApp and the outbox
 * storage MemoryStorage, both from test-support. The last test starts the real sidecar process.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	AGENT_METHODS,
	agent as createAgentApp,
	type NewSessionRequest,
	ndJsonStream,
	type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
	AcpConfigOption,
	AgentInstall,
	AgentLaunch,
	SessionConfig,
	SlashCommand,
	WorkspaceContext,
} from "@conducted/protocol";
import {
	cryptoIds,
	type MessageId,
	ok,
	type SessionId,
	systemClock,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import type { SidecarConfig } from "../config.ts";
import { createLogger, type Logger, type LogRecord } from "../logging/logger.ts";
import type { AcpChild } from "../runners/acp/acp-client.ts";
import type { JsonRpcChild } from "../runners/codex/app-server-client.ts";
import { cursorSdkFiles, FakeCursorRun, FakeCursorSdk } from "../test-support/cursor-fakes.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import { FakeChild, type JsonRpcMessage } from "../test-support/fake-child.ts";
import { FakeInteractions } from "../test-support/fake-interactions.ts";
import { MemoryStorage } from "../test-support/memory-storage.ts";
import { RpcAppToolBackend } from "../tools/backend.ts";
import { appToolsMcpEntry, BRIDGE_TOKEN_ENV } from "../tools/mcp-launch.ts";
import { callBridgeOverSocket } from "../tools/mcp-stdio-server.ts";
import { AppToolsBridge } from "../tools/socket-bridge.ts";
import { AsyncQueue } from "../util/async-queue.ts";
import {
	composeSidecar,
	PARENT_PID_ENV,
	runSidecarMode,
	type SidecarComposition,
	stderrLogSink,
} from "./sidecar-mode.ts";

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

/**
 * The app's bin folder and the agent binaries folder, with a ready managed copy of Claude Code and
 * Codex, as the program manager leaves them after a successful download (PLAT-28).
 */
async function managedPrograms(folder: string): Promise<{
	binDir: string;
	agentBinariesDir: string;
}> {
	const binDir = path.join(folder, "app-bin");
	const agentBinariesDir = path.join(folder, "agent-binaries");
	await mkdir(binDir, { recursive: true });
	for (const name of ["claude", "codex"]) {
		const version = path.join(agentBinariesDir, name, "1.0.0");
		await mkdir(version, { recursive: true });
		const program = path.join(version, name);
		await writeFile(program, "#!/bin/sh\nexit 0\n");
		await chmod(program, 0o755);
		await symlink(program, path.join(binDir, name));
	}
	return { binDir, agentBinariesDir };
}

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

function logger(records: LogRecord[] = []): Logger {
	return createLogger({
		sink: (record) => records.push(record),
		clock: systemClock,
		level: "warn",
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

async function waitFor(check: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

/** Waits for a new idle live-state notification for the chat. */
async function waitForIdle(h: Harness, sessionId: SessionId): Promise<void> {
	const idleCount = (): number =>
		h.app
			.notified("liveState")
			.filter((entry) => entry.sessionId === sessionId && entry.liveState.status === "idle").length;
	const before = idleCount();
	await waitFor(() => idleCount() > before, "the chat to become idle");
}

/** What the scripted outside world saw. */
interface Seen {
	claudeOptions: { options: Options }[];
	codexSpawns: {
		command: string;
		args: readonly string[];
		env: Readonly<Record<string, string>>;
	}[];
	codexChildren: FakeChild[];
	acpNewSessions: NewSessionRequest[];
	/** The files the root imported Cursor's SDK from. */
	cursorImports: string[];
	logs: LogRecord[];
	/** Resolves when the next Codex app server is spawned. */
	nextCodexSpawn(): Promise<void>;
}

interface Harness {
	host: SidecarComposition;
	handlers: SidecarComposition["handlers"]["requests"];
	app: FakeApp;
	seen: Seen;
	home: string;
}

/**
 * The host the composition root builds, over scripted outside-world ports. The login shell has
 * `HOME` in the workspace folder, so a Codex config a test writes there is the user's own.
 */
async function harness(
	folder: string,
	options: {
		acpOptions?: SessionConfigOption[];
		files?: Map<string, string>;
		skillPluginDir?: string;
		/** Cursor's SDK, installed in the agent binaries folder the way the program manager leaves it. */
		cursorSdk?: FakeCursorSdk;
		/** The app's bin and managed programs folders, when a test lays out its own copies. */
		programs?: { binDir: string; agentBinariesDir: string };
		/** False lays out no managed copy, so the tests can check what the app does without one. */
		managedPrograms?: boolean;
		/** A Claude that answers each message and can speak by itself. Default: one that never answers. */
		claude?: TalkingClaude;
		/** User message texts in Claude's transcript, by uuid (RC-03). */
		transcript?: Map<string, string>;
	} = {},
): Promise<Harness> {
	const app = new FakeApp();
	const home = path.join(folder, "home");
	const spawnWaiters: (() => void)[] = [];
	const seen: Seen = {
		claudeOptions: [],
		codexSpawns: [],
		codexChildren: [],
		acpNewSessions: [],
		cursorImports: [],
		logs: [],
		nextCodexSpawn: () => new Promise<void>((resolve) => spawnWaiters.push(resolve)),
	};
	const captured = {
		shell: "/bin/zsh",
		path: "/usr/bin",
		env: { PATH: "/usr/bin", HOME: home },
		providerSecrets: {},
	};
	const programs =
		options.programs ??
		(options.managedPrograms === false ? undefined : await managedPrograms(folder));
	const agentBinariesDir = programs?.agentBinariesDir ?? path.join(folder, "agent-binaries");
	const cursorFiles = cursorSdkFiles(agentBinariesDir, process.arch);
	const host = composeSidecar(
		{
			binDir: programs?.binDir ?? BIN_DIR,
			outboxRoot: path.join(folder, "outbox"),
			completionsDir: path.join(folder, "completions"),
			cursorStoreDir: path.join(folder, "cursor-sdk-store"),
			agentBinariesDir,
			logDir: path.join(folder, "log"),
			skillPluginDir: options.skillPluginDir,
			appVersion: "0.0.0",
			logLevel: "info",
		},
		{
			app,
			query: (options.claude?.query ?? scriptedQuery)(seen.claudeOptions),
			spawnCodex: async (spawned) => {
				seen.codexSpawns.push(spawned);
				const child = scriptedCodex();
				seen.codexChildren.push(child);
				for (const wake of spawnWaiters.splice(0)) wake();
				return ok(child satisfies JsonRpcChild);
			},
			spawnAcp: scriptedAcp(options.acpOptions ?? [], seen.acpNewSessions),
			importCursorSdk: async (entry) => {
				seen.cursorImports.push(entry);
				if (options.cursorSdk === undefined) throw new Error("No Cursor SDK in this test.");
				return options.cursorSdk.module();
			},
			probe: async (command) =>
				ok({ stdout: command.endsWith("opencode") ? "1.18.18" : "1.0.0", stderr: "", exitCode: 0 }),
			// Every program is on the PATH, and a path the user chose is taken as it is.
			findExecutable: async (name) => (name.includes("/") ? name : `/usr/bin/${name}`),
			shellEnv: { get: async () => ok(captured), refresh: async () => ok(captured) },
			runCheckpointer: async () => ({ exitCode: 1, stdout: "", stderr: "not a repository" }),
			outboxStorage: new MemoryStorage(),
			makeTempDir: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
			readText: async (file) => {
				const own = options.files?.get(file);
				if (own !== undefined) return ok(own);
				return options.cursorSdk === undefined ? ok(null) : cursorFiles.readText(file);
			},
			sidecarExecutable: "/Applications/Conducted.app/Contents/MacOS/sidecar",
			hasTranscript: async () => false,
			readUserMessageText: async (_agentSessionId, _cwd, uuid) =>
				options.transcript?.get(uuid) ?? null,
			newToken: () => randomBytes(32).toString("base64url"),
			clock: systemClock,
			ids: cryptoIds,
			logger: logger(seen.logs),
		},
	);
	const started = await host.bridge.start();
	if (!started.ok) throw new Error(started.error.message);
	// The same order the host's shutdown runs: agents, unconfirmed events, then the bridge.
	cleanups.push(async () => {
		await host.sessions.shutdown("app_quit");
		for (const sessionId of host.outbox.sessionsWithPending()) {
			await host.publisher.flush(sessionId);
		}
		await host.bridge.stop();
	});
	return { host, handlers: host.handlers.requests, app, seen, home };
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

/**
 * A Claude SDK stream that answers each message the chat pushes with a reply and a result for that
 * message, and stays open until the session is stopped. `say` adds a message as if the CLI sent it on
 * its own, for example when a background task finished and woke it.
 */
interface TalkingClaude {
	query(
		captured: { options: Options }[],
	): (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query;
	say(message: SDKMessage): void;
	/** How many interrupts the session sent. Each one makes the CLI stop its work and go idle. */
	interrupts(): number;
}

function talkingClaude(): TalkingClaude {
	let current: AsyncQueue<SDKMessage> | null = null;
	let interrupts = 0;
	return {
		interrupts: () => interrupts,
		query: (captured) => (params) => {
			const options = params.options ?? {};
			captured.push({ options });
			const out = new AsyncQueue<SDKMessage>();
			current = out;
			options.abortController?.signal.addEventListener("abort", () => out.close(), {
				once: true,
			});
			void (async () => {
				for await (const pushed of params.prompt) {
					out.push(claudeText("hello back"));
					out.push(claudeResult(pushed.uuid ?? ""));
				}
				out.close();
			})();
			return {
				[Symbol.asyncIterator]: () => out[Symbol.asyncIterator](),
				interrupt: async () => {
					interrupts += 1;
					out.push(claudeState("idle"));
				},
				setModel: async () => {},
				setPermissionMode: async () => {},
				applyFlagSettings: async () => {},
				supportedModels: async () => [],
				supportedCommands: async () => [],
				mcpServerStatus: async () => [],
				getContextUsage: async () => ({ totalTokens: 0, maxTokens: 0 }),
				usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({}),
				// The pinned SDK's Remote Control method, answering as Claude did in the spike (D074).
				enableRemoteControl: async (enabled: boolean) =>
					enabled
						? {
								session_url: REMOTE_SESSION_URL,
								bridge_session_id: "session_remote_1",
								bridge_epoch: 1,
							}
						: undefined,
			} as unknown as Query;
		},
		say: (message) => {
			if (current === null) throw new Error("No Claude session is running.");
			current.push(message);
		},
	};
}

const REMOTE_SESSION_URL = "https://claude.ai/code/session_remote_1";

function bridgeState(state: string): SDKMessage {
	return {
		type: "system",
		subtype: "bridge_state",
		state,
		bridge_epoch: 1,
		uuid: randomBytes(8).toString("hex"),
		session_id: "claude-session-1",
	} as unknown as SDKMessage;
}

function claudeText(text: string): SDKMessage {
	return {
		type: "assistant",
		message: { role: "assistant", content: [{ type: "text", text }] },
		parent_tool_use_id: null,
		session_id: "claude-session-1",
		uuid: randomBytes(8).toString("hex"),
	} as unknown as SDKMessage;
}

/** A result that answers the user message with `uuid`, or a turn the CLI ran for itself. */
function claudeResult(uuid: string): SDKMessage {
	return {
		type: "result",
		subtype: "success",
		is_error: false,
		num_turns: 1,
		user_message_uuid: uuid,
		duration_ms: 1,
		duration_api_ms: 1,
		stop_reason: "end_turn",
		total_cost_usd: 0,
		usage: {},
		modelUsage: {},
		permission_denials: [],
		errors: [],
		result: "",
		uuid: randomBytes(8).toString("hex"),
		session_id: "claude-session-1",
	} as unknown as SDKMessage;
}

function claudeState(state: "running" | "idle"): SDKMessage {
	return {
		type: "system",
		subtype: "session_state_changed",
		state,
		uuid: randomBytes(8).toString("hex"),
		session_id: "claude-session-1",
	} as unknown as SDKMessage;
}

/** The options of the chat's own session, not the metadata query warmAgent runs first. */
const sessionOptions = (captured: { options: Options }[]): Options[] =>
	captured
		.map((entry) => entry.options)
		.filter((options) => options.env?.CONDUCTED_SESSION_ID !== undefined);

/** A Codex app server that keeps a goal, answers the handshake and thread calls, and compacts. */
function scriptedCodex(): FakeChild {
	const child = new FakeChild();
	let goal: Record<string, unknown> | null = null;
	const answer = (message: JsonRpcMessage, result: unknown): void => {
		queueMicrotask(() => child.emit({ jsonrpc: "2.0", id: message.id, result }));
	};
	child.onWrite = (message) => {
		if (message.id === undefined) return;
		const params = (message.params ?? {}) as Record<string, unknown>;
		if (message.method === "initialize") answer(message, { serverVersion: "0.154.0" });
		else if (message.method === "model/list") answer(message, { data: [], nextCursor: null });
		else if (message.method === "thread/start") {
			answer(message, { thread: { id: "thread-1" }, model: "gpt-5" });
		} else if (message.method === "thread/goal/get") {
			answer(message, { goal });
		} else if (message.method === "thread/goal/set") {
			goal = {
				threadId: "thread-1",
				objective:
					typeof params.objective === "string" ? params.objective : (goal?.objective ?? "ship"),
				status: typeof params.status === "string" ? params.status : "active",
				tokenBudget: typeof params.tokenBudget === "number" ? params.tokenBudget : null,
				tokensUsed: 0,
				timeUsedSeconds: 0,
				createdAt: 1,
				updatedAt: 2,
			};
			answer(message, { goal });
			child.emit({
				jsonrpc: "2.0",
				method: "thread/goal/updated",
				params: { threadId: "thread-1", turnId: null, goal },
			});
		} else if (message.method === "thread/goal/clear") {
			goal = null;
			answer(message, { cleared: true });
			child.emit({
				jsonrpc: "2.0",
				method: "thread/goal/cleared",
				params: { threadId: "thread-1" },
			});
		} else if (message.method === "thread/compact/start") {
			answer(message, {});
			queueMicrotask(() =>
				child.emit({
					jsonrpc: "2.0",
					method: "thread/compacted",
					params: { threadId: "thread-1" },
				}),
			);
		} else if (message.method === "turn/start") {
			answer(message, { turn: { id: "turn-1", status: "inProgress", error: null } });
			queueMicrotask(() =>
				child.emit({
					jsonrpc: "2.0",
					method: "turn/completed",
					params: {
						threadId: "thread-1",
						turn: { id: "turn-1", status: "completed", error: null },
					},
				}),
			);
		} else answer(message, {});
	};
	return child;
}

/** An ACP agent in memory that offers `configOptions` and records each session/new. */
function scriptedAcp(
	configOptions: SessionConfigOption[],
	newSessions: NewSessionRequest[],
): () => Promise<ReturnType<typeof ok<AcpChild>>> {
	const current = { options: configOptions };
	return async () => {
		const toAgent = new TransformStream<Uint8Array, Uint8Array>();
		const toChild = new TransformStream<Uint8Array, Uint8Array>();
		const app = createAgentApp({ name: "join" })
			.onRequest(AGENT_METHODS.initialize, () => ({
				protocolVersion: 1,
				agentCapabilities: { sessionCapabilities: { close: {} } },
				agentInfo: { name: "join", version: "1.18.18" },
			}))
			.onRequest(AGENT_METHODS.session_new, ({ params }) => {
				newSessions.push(params as NewSessionRequest);
				return { sessionId: "acp-session-1", configOptions: current.options };
			})
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
	};
}

/** Calls an app tool over the bridge socket with a token, as the helper process does. */
async function callTool(
	host: SidecarComposition,
	sessionId: SessionId,
	token: string,
): Promise<unknown> {
	const endpoint = host.bridge.currentEndpoint;
	if (endpoint === null) throw new Error("The bridge is not listening.");
	return JSON.parse(
		await callBridgeOverSocket(
			endpoint.socketPath,
			JSON.stringify({ authToken: token, sessionId, toolName: "GetWorkspaceDiff", args: {} }),
		),
	);
}

function sendParams(
	folder: string,
	config: SessionConfig,
	launch: AgentLaunch = { env: {}, providerKeys: {} },
) {
	return {
		sessionId: "session-1" as SessionId,
		messageId: "message-1" as MessageId,
		turnId: "turn-1" as TurnId,
		text: "hello",
		attachmentPaths: [],
		delivery: "new_turn" as const,
		firstMessage: false,
		config,
		workspace: workspaceFor(folder),
		launch,
	};
}

const codexConfigArg = (args: readonly string[], key: string): string | undefined =>
	args.find((arg) => arg.startsWith(`mcp_servers.conducted.${key}=`));

describe("s1-sidecar join the batch through the composition root", () => {
	test("AGENT-16 the chat's output style, effort and Chrome reach the Claude session", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const captured = h.seen.claudeOptions;
		const config = baseConfig({
			effort: "ultra",
			fastMode: true,
			claudeOutputStyle: "concise",
			claudeInChrome: true,
		});
		try {
			await h.handlers.warmAgent({
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
			await h.host.sessions.shutdown("app_quit");
		}
	});

	describe("AGENT-18 the bundled skill plugin reaches Claude", () => {
		test("AGENT-18 the bundled skill plugin reaches the Claude session", async () => {
			const folder = await workspaceFolder();
			const skillDir = path.join(folder, "conducted-skill");
			await mkdir(skillDir, { recursive: true });
			const h = await harness(folder, { skillPluginDir: skillDir });
			try {
				await h.handlers.warmAgent({
					sessionId: "session-1" as SessionId,
					config: baseConfig(),
					workspace: workspaceFor(folder),
					launch: { env: {}, providerKeys: {} },
				});

				const options = sessionOptions(h.seen.claudeOptions);
				expect(options).toHaveLength(1);
				expect(options[0]?.plugins).toEqual([{ type: "local", path: skillDir }]);
			} finally {
				await h.host.sessions.shutdown("app_quit");
			}
		});

		test("AGENT-18 a build without a skill folder starts Claude without plugins", async () => {
			const folder = await workspaceFolder();
			const h = await harness(folder);
			try {
				await h.handlers.warmAgent({
					sessionId: "session-1" as SessionId,
					config: baseConfig(),
					workspace: workspaceFor(folder),
					launch: { env: {}, providerKeys: {} },
				});

				const options = sessionOptions(h.seen.claudeOptions);
				expect(options).toHaveLength(1);
				expect(options[0]?.plugins).toBeUndefined();
			} finally {
				await h.host.sessions.shutdown("app_quit");
			}
		});
	});

	test("AGENT-17 the ACP chat options are listed and set through the handlers", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder, {
			acpOptions: [
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
			],
		});
		const config = baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" });
		try {
			await h.handlers.warmAgent({
				sessionId: "session-1" as SessionId,
				config,
				workspace: workspaceFor(folder),
				launch: { env: {}, providerKeys: {} },
			});

			const listed = unwrap<{ options: AcpConfigOption[] }>(
				await h.handlers.listAcpConfigOptions({
					sessionId: "session-1" as SessionId,
				}),
			);
			expect(listed.options.map((option) => option.id)).toEqual(["thought_level"]);

			const changed = unwrap<{ options: AcpConfigOption[] }>(
				await h.handlers.setAcpConfigOption({
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
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("SIDE-21 the launch's variables and own provider key fill the runner environment", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const captured = h.seen.claudeOptions;
		try {
			await h.handlers.warmAgent({
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
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("SIDE-21 a changed launch restarts the idle agent with the new environment", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const captured = h.seen.claudeOptions;
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
			await h.handlers.warmAgent(params);
			await h.handlers.warmAgent({
				...params,
				launch: { env: { SETTING_VALUE: "two" }, providerKeys: {} },
			});

			const options = sessionOptions(captured);
			expect(options).toHaveLength(2);
			expect(((options[0]?.env ?? {}) as Record<string, string>).SETTING_VALUE).toBe("one");
			expect(((options[1]?.env ?? {}) as Record<string, string>).SETTING_VALUE).toBe("two");
		} finally {
			await h.host.sessions.shutdown("app_quit");
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

	test("SIDE-21 SIDE-13 a Codex chat starts the launch's program with the app tools server from the root", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const spawned = h.seen.nextCodexSpawn();

		const sent = await h.handlers.sendMessage(
			sendParams(folder, baseConfig({ agent: "codex", model: "gpt-5" }), {
				env: {},
				providerKeys: {},
				executablePath: "/opt/codex/bin/codex",
			}),
		);
		await spawned;

		expect(unwrap<{ deliveredAs: string }>(sent)).toEqual({ deliveredAs: "new_turn" });
		const spawn = h.seen.codexSpawns[0];
		expect(spawn?.command).toBe("/opt/codex/bin/codex");
		expect(codexConfigArg(spawn?.args ?? [], "command")).toBe(
			'mcp_servers.conducted.command="/Applications/Conducted.app/Contents/MacOS/sidecar"',
		);
		expect(codexConfigArg(spawn?.args ?? [], "env_vars")).toBe(
			'mcp_servers.conducted.env_vars=["CONDUCTED_APP_TOOLS_TOKEN"]',
		);
		const token = spawn?.env[BRIDGE_TOKEN_ENV] ?? "";
		expect(token).not.toBe("");
		expect((spawn?.args ?? []).join(" ")).not.toContain(token);
		expect(await callTool(h.host, "session-1" as SessionId, token)).toMatchObject({ ok: true });

		await h.handlers.resetAgent({ sessionId: "session-1" as SessionId });

		expect(await callTool(h.host, "session-1" as SessionId, token)).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});

	test("D088 a managed agent with no managed copy fails with its name and never runs the PATH copy", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder, { managedPrograms: false });

		const sent = await h.handlers.sendMessage(sendParams(folder, baseConfig()));

		expect("ok" in sent && sent.ok).toBe(false);
		if ("ok" in sent && !sent.ok) {
			expect(sent.error.code).toBe("agent_not_installed");
			expect(sent.error.message).toContain("Claude Code");
			expect(sent.error.message).toContain("Retry");
		}
		expect(h.seen.claudeOptions).toEqual([]);
	});

	test("PLAT-28 PLAT-35 a Codex chat with no chosen program starts the managed copy, with the bin folder first on PATH", async () => {
		const folder = await workspaceFolder();
		const binDir = path.join(folder, "app-bin");
		const agentBinariesDir = path.join(folder, "agent-binaries");
		const version = path.join(agentBinariesDir, "codex", "0.164.0");
		await mkdir(binDir, { recursive: true });
		await mkdir(version, { recursive: true });
		const managed = path.join(version, "codex");
		await writeFile(managed, "#!/bin/sh\nexit 0\n");
		await chmod(managed, 0o755);
		await symlink(managed, path.join(binDir, "codex"));
		const h = await harness(folder, { programs: { binDir, agentBinariesDir } });
		const spawned = h.seen.nextCodexSpawn();

		await h.handlers.sendMessage(
			sendParams(folder, baseConfig({ agent: "codex", model: "gpt-5" })),
		);
		await spawned;

		const spawn = h.seen.codexSpawns[0];
		expect(spawn?.command).toBe(await realpath(managed));
		expect(spawn?.env.PATH).toBe(`${binDir}:/usr/bin`);
		const installs = unwrap<{ agents: AgentInstall[] }>(await h.handlers.getAgentInstalls({}));
		expect(installs.agents.find((install) => install.agent === "codex")).toMatchObject({
			installed: true,
			source: "managed",
			version: "0.164.0",
		});
	});

	test("SIDE-13 an ACP chat's session/new carries the app tools server and its token from the root", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder, {
			acpOptions: [
				{
					type: "select",
					id: "model",
					name: "Model",
					category: "model",
					currentValue: "one",
					options: [{ value: "one", name: "One" }],
				},
			],
		});

		await h.handlers.warmAgent({
			sessionId: "session-1" as SessionId,
			config: baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" }),
			workspace: workspaceFor(folder),
			launch: { env: {}, providerKeys: {} },
		});
		await h.handlers.listAcpConfigOptions({ sessionId: "session-1" as SessionId });

		// The model list opens a throwaway session with no servers; the chat's own session has ours.
		const chatSession = h.seen.acpNewSessions.find((request) => request.mcpServers.length > 0);
		const server = chatSession?.mcpServers[0] as {
			name: string;
			command: string;
			args: string[];
			env: { name: string; value: string }[];
		};
		expect(server.name).toBe("conducted");
		expect(server.command).toBe("/Applications/Conducted.app/Contents/MacOS/sidecar");
		expect(server.args.slice(0, 3)).toEqual(["app-tools-mcp", "--session-id", "session-1"]);
		const token = server.env.find((entry) => entry.name === BRIDGE_TOKEN_ENV)?.value ?? "";
		expect(await callTool(h.host, "session-1" as SessionId, token)).toMatchObject({ ok: true });

		await h.handlers.resetAgent({ sessionId: "session-1" as SessionId });

		expect(await callTool(h.host, "session-1" as SessionId, token)).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});

	test("SIDE-13 a Codex config of the user's that defines the reserved name keeps our server out", async () => {
		const folder = await workspaceFolder();
		const userConfig = path.join(folder, "home", ".codex", "config.toml");
		const h = await harness(folder, {
			files: new Map([[userConfig, '[mcp_servers.conducted]\nurl = "http://localhost:9/mcp"\n']]),
		});
		const spawned = h.seen.nextCodexSpawn();

		await h.handlers.sendMessage(
			sendParams(folder, baseConfig({ agent: "codex", model: "gpt-5" })),
		);
		await spawned;

		expect(h.seen.codexSpawns[0]?.args).toEqual(["app-server", "--listen", "stdio://"]);
		expect(h.seen.codexSpawns[0]?.env[BRIDGE_TOKEN_ENV]).toBeUndefined();
		expect(
			h.seen.logs.some((record) => record.level === "warn" && record.data?.file === userConfig),
		).toBe(true);
	});

	test("SIDE-13 with the bridge down a Codex chat does not start without its tools", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		await h.host.bridge.stop();

		const sent = await h.handlers.sendMessage(
			sendParams(folder, baseConfig({ agent: "codex", model: "gpt-5" })),
		);

		expect("ok" in sent && sent.ok).toBe(false);
		expect(h.seen.codexSpawns).toEqual([]);
		expect(
			h.seen.logs.some((record) => String(record.data?.message).includes("app tools bridge")),
		).toBe(true);
	});

	test("AGENT-15 work the Claude program starts by itself shows working, is stored and ends idle", async () => {
		const folder = await workspaceFolder();
		const claude = talkingClaude();
		const h = await harness(folder, { claude });
		const sessionId = "session-1" as SessionId;
		try {
			const sent = await h.handlers.sendMessage(sendParams(folder, baseConfig()));
			expect(unwrap<{ deliveredAs: string }>(sent)).toEqual({ deliveredAs: "new_turn" });
			await waitForIdle(h, sessionId);
			const statusesBefore = h.app.notified("liveState").length;
			const eventsBefore = h.app.notified("sessionEvent").length;

			// A background task finished and woke the CLI: it works with no message from the user.
			claude.say(claudeState("running"));
			claude.say(claudeText("The background build finished."));
			claude.say(claudeResult("a-message-the-cli-sent-itself"));
			claude.say(claudeState("idle"));
			await waitForIdle(h, sessionId);

			const statuses = h.app
				.notified("liveState")
				.slice(statusesBefore)
				.filter((entry) => entry.sessionId === sessionId)
				.map((entry) => entry.liveState.status);
			expect(statuses[0]).toBe("working");
			expect(statuses.at(-1)).toBe("idle");

			const events = h.app
				.notified("sessionEvent")
				.slice(eventsBefore)
				.filter((entry) => entry.sessionId === sessionId)
				.map((entry) => entry.event);
			const texts = events.flatMap((event) =>
				event.type === "agent"
					? event.message.items.flatMap((item) => (item.kind === "text" ? [item.text] : []))
					: [],
			);
			expect(texts).toEqual(["The background build finished."]);
			const ended = events.filter((event) => event.type === "turn_ended");
			expect(ended).toHaveLength(1);
			expect(ended[0]).toMatchObject({ outcome: "success" });
			const turnId = ended[0]?.type === "turn_ended" ? ended[0].turnId : undefined;
			expect(turnId).not.toBe("turn-1");
			expect(events.every((event) => event.type !== "user_message")).toBe(true);
			expect(events.every((event) => !("turnId" in event) || event.turnId === turnId)).toBe(true);
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("AGENT-15 a message sent while Claude works by itself waits and starts when that work ends", async () => {
		const folder = await workspaceFolder();
		const claude = talkingClaude();
		const h = await harness(folder, { claude });
		const sessionId = "session-1" as SessionId;
		try {
			await h.handlers.sendMessage(sendParams(folder, baseConfig()));
			await waitForIdle(h, sessionId);

			claude.say(claudeState("running"));
			await waitFor(
				() => h.app.notified("liveState").at(-1)?.liveState.status === "working",
				"the chat to show working",
			);
			const queued = await h.handlers.sendMessage({
				...sendParams(folder, baseConfig()),
				messageId: "message-2" as MessageId,
				turnId: "turn-2" as TurnId,
				text: "and then?",
			});
			expect(unwrap<{ deliveredAs: string }>(queued)).toEqual({ deliveredAs: "queued" });

			claude.say(claudeState("idle"));
			await waitFor(
				() =>
					h.app
						.notified("sessionEvent")
						.some(
							(entry) =>
								entry.event.type === "turn_ended" && entry.event.turnId === ("turn-2" as TurnId),
						),
				"the queued message's turn to end",
			);
			const userMessages = h.app
				.notified("sessionEvent")
				.flatMap((entry) => (entry.event.type === "user_message" ? [entry.event.text] : []));
			expect(userMessages).toEqual(["hello", "and then?"]);
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("AGENT-15 cancel while Claude works by itself stops that work and stores it as cancelled", async () => {
		const folder = await workspaceFolder();
		const claude = talkingClaude();
		const h = await harness(folder, { claude });
		const sessionId = "session-1" as SessionId;
		try {
			await h.handlers.sendMessage(sendParams(folder, baseConfig()));
			await waitForIdle(h, sessionId);
			const eventsBefore = h.app.notified("sessionEvent").length;

			claude.say(claudeState("running"));
			claude.say(claudeText("Rebuilding after the background task."));
			await waitFor(
				() => h.app.notified("liveState").at(-1)?.liveState.status === "working",
				"the chat to show working",
			);
			const cancelled = await h.handlers.cancel({ sessionId });

			expect(unwrap<{ wasWorking: boolean }>(cancelled)).toMatchObject({ wasWorking: true });
			expect(claude.interrupts()).toBe(1);
			await waitFor(
				() =>
					h.app
						.notified("sessionEvent")
						.slice(eventsBefore)
						.some((entry) => entry.event.type === "turn_ended"),
				"the cancelled work to be stored",
			);
			const ended = h.app
				.notified("sessionEvent")
				.slice(eventsBefore)
				.flatMap((entry) => (entry.event.type === "turn_ended" ? [entry.event] : []));
			expect(ended).toHaveLength(1);
			expect(ended[0]).toMatchObject({ outcome: "cancelled" });
			expect(h.app.notified("liveState").at(-1)?.liveState).toMatchObject({
				status: "idle",
				error: "aborted by user",
			});
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("RC-02 RC-03 a chat shared through Remote Control reports its link and stores a message typed on claude.ai", async () => {
		const folder = await workspaceFolder();
		const claude = talkingClaude();
		const h = await harness(folder, {
			claude,
			transcript: new Map([["remote-1", "Add a test for the parser"]]),
		});
		const sessionId = "session-1" as SessionId;
		try {
			await h.handlers.sendMessage(sendParams(folder, baseConfig({ remoteControl: true })));
			await waitForIdle(h, sessionId);
			await waitFor(
				() =>
					h.app
						.notified("remoteControlState")
						.some((entry) => entry.status.sessionUrl === REMOTE_SESSION_URL),
				"the Remote Control link",
			);
			claude.say(bridgeState("ready"));
			claude.say(bridgeState("connected"));
			await waitFor(
				() => h.app.notified("remoteControlState").at(-1)?.status.state === "connected",
				"the link to connect",
			);
			const status = unwrap<{ remoteControl?: unknown }>(
				await h.handlers.getSessionStatus({ sessionId }),
			);
			expect(status.remoteControl).toEqual({ state: "connected", sessionUrl: REMOTE_SESSION_URL });

			// The owner types on claude.ai: the CLI runs the turn, and its frames name the message.
			claude.say(claudeState("running"));
			claude.say({
				...(claudeText("Adding the test.") as object),
				user_message_uuid: "remote-1",
			} as unknown as SDKMessage);
			claude.say(claudeResult("remote-1"));
			claude.say(claudeState("idle"));
			await waitFor(
				() =>
					h.app
						.notified("sessionEvent")
						.some(
							(entry) =>
								entry.event.type === "user_message" && entry.event.sender?.kind === "claude_ai",
						),
				"the message from claude.ai to be stored",
			);
			const events = h.app
				.notified("sessionEvent")
				.filter((entry) => entry.sessionId === sessionId)
				.map((entry) => entry.event);
			const remote = events.find(
				(event) => event.type === "user_message" && event.sender?.kind === "claude_ai",
			);
			expect(remote).toMatchObject({
				text: "Add a test for the parser",
				delivery: "new_turn",
				messageId: "remote-1",
			});
			const reply = events.find(
				(event) =>
					event.type === "agent" &&
					event.message.items.some(
						(item) => item.kind === "text" && item.text === "Adding the test.",
					),
			);
			expect(reply?.turnId).toBe(remote?.turnId as TurnId);
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("SIDE-21 a Claude chat runs the program its launch names", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);

		await h.handlers.warmAgent({
			sessionId: "session-1" as SessionId,
			config: baseConfig(),
			workspace: workspaceFor(folder),
			launch: { env: {}, providerKeys: {}, executablePath: "/opt/claude/cli.js" },
		});

		const options = sessionOptions(h.seen.claudeOptions);
		expect(options[0]?.pathToClaudeCodeExecutable).toBe("/opt/claude/cli.js");
		expect(options[0]?.executable).toBe("node");
	});

	test("AGENT-09 AGENT-10 a Cursor chat starts the SDK in process and translates its output", async () => {
		const folder = await workspaceFolder();
		const run = new FakeCursorRun();
		run.messages.push({
			type: "assistant",
			content: [{ type: "text", text: "from cursor" }],
		});
		run.finish();
		const sdk = new FakeCursorSdk(run);
		const h = await harness(folder, { cursorSdk: sdk });
		const sessionId = "session-1" as SessionId;
		try {
			const sent = await h.handlers.sendMessage(
				sendParams(folder, baseConfig({ agent: "cursor", model: "composer-2.5" }), {
					env: { CURSOR_API_KEY: "cursor-key" },
					providerKeys: {},
				}),
			);
			expect(unwrap<{ deliveredAs: string }>(sent)).toEqual({ deliveredAs: "new_turn" });
			await waitForIdle(h, sessionId);

			expect(sdk.resumeCalls).toHaveLength(1);
			expect(sdk.resumeCalls[0]?.agentId).toBe(sessionId);
			expect(sdk.resumeCalls[0]?.options.apiKey).toBe("cursor-key");
			expect(sdk.resumeCalls[0]?.options.model.id).toBe("composer-2.5");
			expect(sdk.agent.sent).toEqual(["hello"]);

			const agentMessages = h.app
				.notified("sessionEvent")
				.filter((entry) => entry.sessionId === sessionId && entry.event.type === "agent")
				.flatMap((entry) => (entry.event.type === "agent" ? [entry.event.message] : []));
			expect(agentMessages.map((message) => message.agent)).toContain("cursor");
			const textItems = agentMessages
				.flatMap((message) => message.items)
				.filter((item) => item.kind === "text")
				.map((item) => (item.kind === "text" ? item.text : ""));
			expect(textItems).toContain("from cursor");
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("AGENT-09 the agent list shows Cursor's installed SDK as the app's own copy without loading it", async () => {
		const folder = await workspaceFolder();
		const installed = await harness(folder, { cursorSdk: new FakeCursorSdk() });
		const missing = await harness(await workspaceFolder());

		const withSdk = unwrap<{ agents: AgentInstall[] }>(
			await installed.handlers.getAgentInstalls({}),
		).agents.find((install) => install.agent === "cursor");
		const withoutSdk = unwrap<{ agents: AgentInstall[] }>(
			await missing.handlers.getAgentInstalls({}),
		).agents.find((install) => install.agent === "cursor");

		expect(withSdk).toMatchObject({
			installed: true,
			source: "managed",
			version: "1.3.1",
			path: path.join(folder, "agent-binaries", "cursor", "current"),
		});
		expect(withoutSdk?.installed).toBe(false);
		expect(installed.seen.cursorImports).toEqual([]);
		expect(missing.seen.cursorImports).toEqual([]);
	});

	test("AGENT-09 a Cursor chat without the SDK installed fails and points to the Advanced page", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const sessionId = "session-1" as SessionId;
		try {
			await h.handlers.sendMessage(
				sendParams(folder, baseConfig({ agent: "cursor", model: "composer-2.5" }), {
					env: { CURSOR_API_KEY: "cursor-key" },
					providerKeys: {},
				}),
			);
			await waitForIdle(h, sessionId);

			const errors = h.app
				.notified("liveState")
				.filter((entry) => entry.sessionId === sessionId)
				.map((entry) => entry.liveState.error ?? "");
			expect(errors.join("\n")).toContain("Install it on the Advanced page of Settings.");
			expect(h.seen.cursorImports).toEqual([]);
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("AGENT-09 a Cursor chat gets the app tools and its run store folder from the root", async () => {
		const folder = await workspaceFolder();
		const run = new FakeCursorRun();
		run.finish();
		const sdk = new FakeCursorSdk(run);
		const h = await harness(folder, { cursorSdk: sdk });
		const sessionId = "session-1" as SessionId;
		try {
			await h.handlers.sendMessage(
				sendParams(folder, baseConfig({ agent: "cursor", model: "composer-2.5" }), {
					env: { CURSOR_API_KEY: "cursor-key" },
					providerKeys: {},
				}),
			);
			await waitForIdle(h, sessionId);

			const options = sdk.resumeCalls[0]?.options;
			expect(
				sdk.platformCalls[0]?.stateRoot.startsWith(path.join(folder, "cursor-sdk-store")),
			).toBe(true);
			const server = options?.mcpServers?.conducted as {
				command: string;
				args: string[];
				env: Record<string, string>;
			};
			expect(server.command).toBe("/Applications/Conducted.app/Contents/MacOS/sidecar");
			expect(server.args.slice(0, 3)).toEqual(["app-tools-mcp", "--session-id", sessionId]);
			const token = server.env[BRIDGE_TOKEN_ENV] ?? "";
			expect(await callTool(h.host, sessionId, token)).toMatchObject({ ok: true });

			await h.handlers.resetAgent({ sessionId });

			expect(await callTool(h.host, sessionId, token)).toEqual({
				ok: false,
				error: "Unauthorized",
			});
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("AGENT-13 a Codex chat sets, reads, pauses, resumes and clears its goal", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const sessionId = "session-1" as SessionId;
		try {
			await h.handlers.sendMessage(
				sendParams(folder, baseConfig({ agent: "codex", model: "gpt-5" })),
			);
			await waitForIdle(h, sessionId);

			const set = unwrap<{ goal: { objective: string; status: string; tokenBudget?: number } }>(
				await h.handlers.setGoal({
					sessionId,
					objective: "ship the join",
					tokenBudget: 500,
				}),
			);
			expect(set.goal).toMatchObject({
				objective: "ship the join",
				status: "active",
				tokenBudget: 500,
			});

			const read = unwrap<{ goal: { objective: string } | null }>(
				await h.handlers.getGoal({ sessionId }),
			);
			expect(read.goal?.objective).toBe("ship the join");

			const paused = unwrap<{ goal: { status: string } | null }>(
				await h.handlers.changeGoal({ sessionId, action: "pause" }),
			);
			expect(paused.goal?.status).toBe("paused");

			const resumed = unwrap<{ goal: { status: string } | null }>(
				await h.handlers.changeGoal({ sessionId, action: "resume" }),
			);
			expect(resumed.goal?.status).toBe("active");

			const cleared = unwrap<{ goal: unknown }>(
				await h.handlers.changeGoal({ sessionId, action: "clear" }),
			);
			expect(cleared.goal).toBeNull();
			expect(h.app.notified("goalChanged").length).toBeGreaterThanOrEqual(4);
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("AGENT-14 a Codex chat compacts its history through the compact handler", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const sessionId = "session-1" as SessionId;
		try {
			await h.handlers.sendMessage(
				sendParams(folder, baseConfig({ agent: "codex", model: "gpt-5" })),
			);
			await waitForIdle(h, sessionId);

			const started = unwrap<{ started: boolean }>(await h.handlers.compact({ sessionId }));
			expect(started).toEqual({ started: true });
			await waitForIdle(h, sessionId);

			expect(
				h.seen.codexChildren[0]?.lines.some((line) => line.method === "thread/compact/start"),
			).toBe(true);
			const notices = h.app
				.notified("sessionEvent")
				.filter((entry) => entry.sessionId === sessionId && entry.event.type === "agent")
				.flatMap((entry) => (entry.event.type === "agent" ? entry.event.message.items : []))
				.filter((item) => item.kind === "notice");
			expect(notices.some((item) => item.kind === "notice" && item.notice === "compacted")).toBe(
				true,
			);
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("SIDE-18 the mode reads the launcher's log settings and writes JSON log lines", async () => {
		const folder = await workspaceFolder();
		const config: SidecarConfig = {
			binDir: BIN_DIR,
			outboxRoot: path.join(folder, "outbox"),
			completionsDir: path.join(folder, "completions"),
			cursorStoreDir: path.join(folder, "cursor-sdk-store"),
			agentBinariesDir: path.join(folder, "agent-binaries"),
			logDir: path.join(folder, "log"),
			appVersion: "9.9.9",
			logLevel: "debug",
		};
		const received: SidecarConfig[] = [];
		const lines: string[] = [];
		const code = await runSidecarMode(
			{
				CONDUCTED_BIN_DIR: config.binDir,
				CONDUCTED_OUTBOX_ROOT: config.outboxRoot,
				CONDUCTED_COMPLETIONS_DIR: config.completionsDir,
				CONDUCTED_CURSOR_STORE_DIR: config.cursorStoreDir,
				CONDUCTED_AGENT_BINARIES_DIR: config.agentBinariesDir,
				CONDUCTED_LOG_DIR: config.logDir,
				CONDUCTED_APP_VERSION: config.appVersion,
				CONDUCTED_LOG_LEVEL: config.logLevel,
			},
			["sidecar"],
			{
				writeError: () => {},
				writeOut: () => {},
				createLogger: (parsed) => {
					received.push(parsed);
					return createLogger({
						sink: stderrLogSink((text) => lines.push(text)),
						clock: systemClock,
						level: parsed.logLevel,
						scope: "sidecar",
					});
				},
				preflight: async () => ({ ok: true, value: undefined }),
				installErrorHandlers: () => () => {},
				startHost: async (input) => {
					input.writeOut("");
					return 0;
				},
			},
		);
		expect(code).toBe(0);
		expect(received[0]).toMatchObject({ appVersion: "9.9.9", logLevel: "debug" });
		const records = lines.map((line) => JSON.parse(line) as LogRecord);
		expect(records).toContainEqual(
			expect.objectContaining({
				level: "info",
				scope: "sidecar",
				message: "The sidecar is starting",
				data: expect.objectContaining({ appVersion: "9.9.9", logLevel: "debug" }),
			}),
		);
	});

	test("SIDE-21 model, slash command and MCP lists run the program and keys of the app's launch", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const launch: AgentLaunch = {
			executablePath: "/opt/claude/bin/claude",
			env: { HTTPS_PROXY: "http://proxy" },
			providerKeys: {
				CLAUDE_CODE_OAUTH_TOKEN: { value: "oauth-token", source: "entered" },
				OPENAI_API_KEY: { value: "sk-codex", source: "entered" },
			},
		};
		try {
			unwrap(await h.handlers.listModels({ agent: "claude", launch }));
			unwrap(
				await h.handlers.listSlashCommands({
					agent: "claude",
					workspacePath: folder,
					repoRootPath: folder,
					launch,
				}),
			);
			unwrap(await h.handlers.listMcpServers({ agent: "claude", workspacePath: folder, launch }));

			expect(h.seen.claudeOptions).toHaveLength(3);
			for (const { options } of h.seen.claudeOptions) {
				expect(options.pathToClaudeCodeExecutable).toBe("/opt/claude/bin/claude");
				expect(options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-token");
				expect(options.env?.HTTPS_PROXY).toBe("http://proxy");
				expect(options.env?.OPENAI_API_KEY).toBeUndefined();
			}
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("PLAT-28 SIDE-21 model, slash command and MCP lists with no chosen program run the managed copy, as a chat's start does", async () => {
		const folder = await workspaceFolder();
		const binDir = path.join(folder, "app-bin");
		const agentBinariesDir = path.join(folder, "agent-binaries");
		const version = path.join(agentBinariesDir, "claude", "2.1.0");
		await mkdir(binDir, { recursive: true });
		await mkdir(version, { recursive: true });
		const managed = path.join(version, "claude");
		await writeFile(managed, "#!/bin/sh\nexit 0\n");
		await chmod(managed, 0o755);
		await symlink(managed, path.join(binDir, "claude"));
		const h = await harness(folder, { programs: { binDir, agentBinariesDir } });
		const launch: AgentLaunch = { env: {}, providerKeys: {} };
		try {
			unwrap(await h.handlers.listModels({ agent: "claude" }));
			unwrap(
				await h.handlers.listSlashCommands({
					agent: "claude",
					workspacePath: folder,
					repoRootPath: folder,
					launch,
				}),
			);
			unwrap(await h.handlers.listMcpServers({ agent: "claude", workspacePath: folder, launch }));

			expect(h.seen.claudeOptions).toHaveLength(3);
			for (const { options } of h.seen.claudeOptions) {
				expect(options.pathToClaudeCodeExecutable).toBe(await realpath(managed));
			}
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("SIDE-21 the agent list reports the program paths the app sends with setAgentPrograms", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		try {
			const before = unwrap<{ agents: AgentInstall[] }>(await h.handlers.getAgentInstalls({}));
			expect(before.agents.find((install) => install.agent === "claude")).toMatchObject({
				installed: true,
				source: "managed",
				version: "1.0.0",
			});

			await h.host.handlers.notifications.setAgentPrograms({
				programs: [{ agent: "claude", path: "/opt/claude/bin/claude" }],
			});

			const after = unwrap<{ agents: AgentInstall[] }>(await h.handlers.getAgentInstalls({}));
			expect(after.agents.find((install) => install.agent === "claude")).toMatchObject({
				path: "/opt/claude/bin/claude",
				source: "user",
			});
			// The change reached the app without it asking (agentInstallsChanged).
			expect(
				h.app
					.notified("agentInstallsChanged")
					.some((sent) => sent.agents.some((install) => install.path === "/opt/claude/bin/claude")),
			).toBe(true);
		} finally {
			await h.host.sessions.shutdown("app_quit");
		}
	});

	test("SIDE-22 the slash command cache answers before a chat starts", async () => {
		const folder = await workspaceFolder();
		const h = await harness(folder);
		const command: SlashCommand = {
			name: "review",
			description: "Review the change",
			source: "project",
			kind: "command",
		};
		try {
			unwrap(await h.host.completions.write({ repoRootPath: folder, agent: "claude" }, [command]));
			const answered = unwrap<{ commands: SlashCommand[]; fromCache: boolean }>(
				await h.handlers.listSlashCommands({
					agent: "claude",
					repoRootPath: folder,
				}),
			);
			expect(answered).toEqual({ commands: [command], fromCache: true });
		} finally {
			await h.host.sessions.shutdown("app_quit");
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
				CONDUCTED_COMPLETIONS_DIR: path.join(folder, "completions"),
				CONDUCTED_CURSOR_STORE_DIR: path.join(folder, "cursor-sdk-store"),
				CONDUCTED_AGENT_BINARIES_DIR: path.join(folder, "agent-binaries"),
				CONDUCTED_LOG_DIR: path.join(folder, "log"),
				CONDUCTED_APP_VERSION: "0.0.0",
				CONDUCTED_LOG_LEVEL: "info",
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
