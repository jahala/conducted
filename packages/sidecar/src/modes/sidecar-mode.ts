/**
 * @feature SIDE-01 Entry point and modes: the "sidecar" mode
 * Owns: starting the agent host. It is the composition root: the one place that creates every
 * real port (processes, files, sockets, clocks) and passes them to the modules.
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 and B1 and sessions.md sections 0, 5
 * and 8. Startup order:
 *  1. read the settings from the environment (config.ts); a bad value prints a message and exits 64
 *  2. create the logger (logging/logger.ts) writing one JSON object per line to stderr, which the
 *     Rust launcher stores in the app log files (D026)
 *  3. capture the login-shell environment (shell-env) in the background; it is needed by the first
 *     agent start, not before
 *  4. open the write-ahead log (outbox/); a failure is fatal: exit 1 with the reason. Conductor
 *     continues without a backup after 1 s; we do not, because the log is what makes delivery safe
 *  5. build the runners, process manager, session manager, interaction broker, publisher and the
 *     app tools backend and bridge
 *  6. listen on the Unix socket (rpc/server.ts) and print SOCKET_PATH=<path> as one line on stdout
 *  7. start the parent watchdog (watchdog.ts: the parent check and the idle sweep run on separate
 *     2-second timers), install one SIGINT and one SIGTERM handler that logs under SIGNAL and
 *     starts the graceful shutdown, install the uncaughtException and unhandledRejection handlers
 *     (log, do not exit), and ask the agent detector for the current list; a detection failure is
 *     logged and never fails the start
 *  8. when the app attaches: replay the write-ahead log, resend the open interaction, and send
 *     agentInstallsChanged if detection changed
 * Must handle: a second sidecar already running for the same app (the launcher kills orphans; the
 * socket path includes the pid, so two never clash), startup steps that fail halfway (the bridge
 * and the socket, once started, are stopped through the shutdown steps; the outbox has no close,
 * and its pending events stay durable for the next start), and stdout carrying only handshake
 * lines (logs go to stderr).
 * Test first: parseSidecarConfig is tested in config.test.ts; here, a start with an unwritable
 * outbox directory exits with code 1 and a message that names the directory.
 * Owned by later features: startSidecarHost calls buildHandlers (SIDE-02), so the real host cannot
 * start until SIDE-02 lands. A smoke test that starts it on a temporary socket path belongs there.
 * Our design choice: the entry only dispatches. All behaviour lives in modes/, so tests call the
 * mode functions without starting a process. The host itself is injected, so a test starts a
 * fake host without touching a real socket.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import {
	type AgentInstall,
	APP_TOOL_SERVER,
	type SessionConfig,
	type SidecarToAppNotification,
	type SidecarToAppRequest,
} from "@conducted/protocol";
import {
	type AppError,
	appError,
	cryptoIds,
	err,
	ok,
	type Result,
	type SessionId,
	systemClock,
} from "@conducted/shared";
import { ScriptCheckpointService } from "../checkpoints/checkpoint-service.ts";
import { parseSidecarConfig, type SidecarConfig } from "../config.ts";
import { createLogger, type Logger, type LogSink } from "../logging/logger.ts";
import { EXIT_USAGE } from "../main.ts";
import { type AgentDetector, DefaultAgentDetector } from "../models/agent-detection.ts";
import { RunnerModelCatalog } from "../models/catalog.ts";
import { RunnerMcpServerLister, RunnerSlashCommandLister } from "../models/slash-and-mcp.ts";
import { SessionUsageReader } from "../models/usage.ts";
import { FileEventOutbox } from "../outbox/event-outbox.ts";
import type { OutboxStorage } from "../outbox/outbox-file.ts";
import { OutboxReplayer } from "../outbox/replay.ts";
import { AgentProcessManager } from "../process/process-manager.ts";
import { MessagePromptAssembler, type PromptFiles } from "../prompt/assemble.ts";
import { writePullRequestStubFile } from "../prompt/pull-request-stub.ts";
import { buildHandlers } from "../rpc/handlers.ts";
import { RpcPeer } from "../rpc/peer.ts";
import { handshakeLine, SocketServer, socketPathFor } from "../rpc/server.ts";
import type {
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "../rpc/types.ts";
import type { AcpChild, SpawnAcpChild } from "../runners/acp/acp-client.ts";
import { AcpRunner } from "../runners/acp/acp-runner.ts";
import { ACP_ADAPTERS } from "../runners/acp/adapters/registry.ts";
import { ClaudeRunner } from "../runners/claude/claude-runner.ts";
import { ClaudePermissionHandler } from "../runners/claude/permission-handler.ts";
import { claudeConfigDir, createTranscriptCheck } from "../runners/claude/transcript.ts";
import { ClaudeTranslator } from "../runners/claude/translate.ts";
import type { Scheduler } from "../runners/claude/turn-tracker.ts";
import type { JsonRpcChild, SpawnJsonRpcChild } from "../runners/codex/app-server-client.ts";
import { CodexRunner } from "../runners/codex/codex-runner.ts";
import { CursorRunner } from "../runners/cursor/cursor-runner.ts";
import type { CursorSdk, LoadCursorSdk } from "../runners/cursor/cursor-sdk.ts";
import { EnvLock } from "../runners/cursor/env-lock.ts";
import type { FindExecutable, ProbeCommand, RunnerCommonDeps } from "../runners/deps.ts";
import type { RunnerRegistry, RunnerSelector } from "../runners/registry.ts";
import { MapRunnerRegistry } from "../runners/registry.ts";
import type { Runner } from "../runners/runner.ts";
import { BatchingEventPublisher } from "../session/event-batcher.ts";
import { SessionInteractionBroker } from "../session/interactions.ts";
import { LiveStateStore, reportWriteFailures } from "../session/live-state.ts";
import { DefaultSessionManager, type ShutdownReason } from "../session/manager.ts";
import { KeyedSerialQueue } from "../session/serial-queue.ts";
import { LoginShellEnvProvider } from "../shell-env/capture.ts";
import { runShutdownSteps, type ShutdownReport, type ShutdownStep } from "../shutdown.ts";
import { RpcAppToolBackend } from "../tools/backend.ts";
import { createAppToolsServer } from "../tools/in-process-server.ts";
import { appToolsMcpEntry } from "../tools/mcp-launch.ts";
import { AppToolsBridge, type BridgeEndpoint, type TokenSource } from "../tools/socket-bridge.ts";
import { messageOf } from "../util/errors.ts";
import { ParentWatchdog } from "../watchdog.ts";

/** A start that fails after the command line was read. Matches the entry point's failure code. */
export const EXIT_START_FAILED = 1;

/** What the host needs from the mode function. */
export interface SidecarHostInput {
	config: SidecarConfig;
	env: Readonly<Record<string, string | undefined>>;
	args: readonly string[];
	logger: Logger;
	/** The one line the Rust launcher reads from stdout. */
	writeOut(text: string): void;
}

/** The composable part of the mode, so a test starts a fake host. */
export type StartSidecarHost = (input: SidecarHostInput) => Promise<number>;

/** The effects the mode needs. Production uses the defaults; tests pass their own. */
export interface SidecarModeIo {
	writeError(text: string): void;
	writeOut(text: string): void;
	createLogger(): Logger;
	/** Checks that the host can write where it must. A failure names the folder. */
	preflight(config: SidecarConfig): Promise<Result<void, AppError>>;
	/** Installs the process error handlers and returns the function that removes them. */
	installErrorHandlers(logger: Logger): () => void;
	startHost: StartSidecarHost;
}

/** The environment variable that holds the Rust shell's pid. */
export const PARENT_PID_ENV = "CONDUCTED_PARENT_PID";

/**
 * Checks the folders the sidecar writes to. A missing bin folder or an unwritable outbox is a
 * startup failure: there is no silent fallback to a default path under the user's home (D027,
 * native-and-sidecar-map D2). The log folder is required by config.ts but is not probed here:
 * nothing writes it yet, and SIDE-18 will own the log file.
 */
export async function preflightDirectories(config: SidecarConfig): Promise<Result<void, AppError>> {
	const bin = await directoryExists(config.binDir);
	if (!bin) {
		return err(
			appError("bin_dir_missing", `The sidecar's bin folder (${config.binDir}) does not exist.`),
		);
	}
	return probeWritable("outbox folder", config.outboxRoot);
}

async function directoryExists(folder: string): Promise<boolean> {
	try {
		return (await stat(folder)).isDirectory();
	} catch {
		return false;
	}
}

async function probeWritable(label: string, folder: string): Promise<Result<void, AppError>> {
	const probe = path.join(folder, `.conducted-write-${process.pid}-${randomUUID()}`);
	try {
		await mkdir(folder, { recursive: true, mode: 0o700 });
		const handle = await open(probe, "wx", 0o600);
		await handle.close();
		await rm(probe);
		return ok(undefined);
	} catch (cause) {
		await rm(probe, { force: true }).catch(() => {});
		return err(
			appError(
				"folder_not_writable",
				`The sidecar cannot write to its ${label} (${folder}): ${messageOf(cause)}`,
			),
		);
	}
}

/** A sink that writes one JSON object per line, as the Rust launcher expects (D026). */
export function stderrLogSink(write: (text: string) => void): LogSink {
	return (record) => {
		write(`${JSON.stringify(record)}\n`);
	};
}

/** The process-level error events the mode handles. Narrow, so a test needs no real process. */
export interface ProcessErrorHooks {
	on(event: "uncaughtException", listener: (error: unknown) => void): void;
	on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
	off(event: "uncaughtException", listener: (error: unknown) => void): void;
	off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
}

/**
 * Logs an uncaught exception or an unhandled rejection and keeps running (sessions.md 8). The
 * sidecar is the only process that runs the user's agents; exiting would lose every chat.
 */
export function installErrorHandlers(
	logger: Logger,
	hooks: ProcessErrorHooks = process,
): () => void {
	const onException = (error: unknown): void => {
		logger.error("Uncaught exception in the sidecar; it keeps running", {
			reason: messageOf(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
	};
	const onRejection = (reason: unknown): void => {
		logger.error("Unhandled promise rejection in the sidecar; it keeps running", {
			reason: messageOf(reason),
		});
	};
	hooks.on("uncaughtException", onException);
	hooks.on("unhandledRejection", onRejection);
	return () => {
		hooks.off("uncaughtException", onException);
		hooks.off("unhandledRejection", onRejection);
	};
}

/** One startup step and how to undo it when a later step fails. */
export interface StartupStep {
	name: string;
	run(): Promise<Result<unknown, AppError>>;
	undo(): ShutdownStep;
}

/**
 * Runs the startup steps in order. When a step fails, every step that already finished is stopped
 * through the shutdown steps, newest first, and the failure is returned. The steps are passed in,
 * so a test proves a half-failed start stops what it started.
 */
export async function runStartupSteps(
	steps: readonly StartupStep[],
	deps: {
		runShutdown(steps: readonly ShutdownStep[]): Promise<ShutdownReport>;
	},
): Promise<Result<void, AppError>> {
	const started: StartupStep[] = [];
	for (const step of steps) {
		const result = await step.run();
		if (!result.ok) {
			const undo = [...started].reverse().map((done) => done.undo());
			if (undo.length > 0) await deps.runShutdown(undo);
			return result;
		}
		started.push(step);
	}
	return ok(undefined);
}

/**
 * Asks the detector for the current agent list at startup. Detection can fail (a slow or missing
 * agent program), and the sidecar must still serve chats, so the failure is logged only.
 */
export async function refreshAgentInstalls(deps: {
	agents: Pick<AgentDetector, "detectAll">;
	logger: Logger;
}): Promise<void> {
	try {
		await deps.agents.detectAll();
	} catch (cause) {
		deps.logger.warn("Could not detect the installed agents at startup", {
			reason: messageOf(cause),
		});
	}
}

/** The log tag Conductor uses for the signal handlers. */
export const SIGNAL_LOG_TAG = "SIGNAL";

export type ShutdownSignal = "SIGINT" | "SIGTERM";

/** The narrow process surface the signal handlers need, so a test passes a fake. */
export interface SignalPort {
	on(signal: ShutdownSignal, listener: () => void): void;
	off(signal: ShutdownSignal, listener: () => void): void;
}

export const processSignals: SignalPort = {
	on: (signal, listener) => process.on(signal, listener),
	off: (signal, listener) => process.off(signal, listener),
};

/**
 * One handler per signal. Each logs the signal under the SIGNAL tag and starts the graceful
 * shutdown, so an operator can see which signal arrived (sessions.md 8).
 */
export function installSignalHandlers(
	logger: Logger,
	signals: SignalPort,
	onSignal: (signal: ShutdownSignal) => void,
): () => void {
	const signalLogger = logger.child(SIGNAL_LOG_TAG);
	const installed: { signal: ShutdownSignal; listener: () => void }[] = [];
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		const listener = (): void => {
			signalLogger.info(`${signal} received; shutting down`, { signal });
			onSignal(signal);
		};
		signals.on(signal, listener);
		installed.push({ signal, listener });
	}
	return () => {
		for (const { signal, listener } of installed) signals.off(signal, listener);
	};
}

/** The real shutdown operations, passed in so a test runs the same list startSidecarHost runs. */
export interface ShutdownEffects {
	stopAgents(reason: ShutdownReason): Promise<void>;
	flushEvents(): Promise<void>;
	closeSocket(): Promise<void>;
	closeAppToolsBridge(): Promise<void>;
}

/**
 * The production shutdown steps in the order the sidecar runs them: stop the agents (no
 * checkpoint), flush the events the app has not confirmed, close the socket, then the app tools
 * bridge. Flushing is the outbox's only shutdown work: our write-ahead log has no handle to close
 * (D007, SIDE-06). There is no HTTP server (D028) and no logger close.
 */
export function createShutdownSteps(
	reason: ShutdownReason,
	effects: ShutdownEffects,
): ShutdownStep[] {
	return [
		{ name: "stop agents", run: () => effects.stopAgents(reason), limitMs: 10_000 },
		{ name: "flush events", run: () => effects.flushEvents(), limitMs: 10_000 },
		{ name: "close socket", run: () => effects.closeSocket(), limitMs: 5_000 },
		{ name: "close app tools bridge", run: () => effects.closeAppToolsBridge(), limitMs: 5_000 },
	];
}

export interface ShutdownCoordinatorDeps {
	logger: Logger;
	effects: ShutdownEffects;
	runShutdown(steps: readonly ShutdownStep[]): Promise<ShutdownReport>;
	/** Stops what must not run during shutdown: the watchdog, the attach listener, the signals. */
	beforeShutdown(): void;
	finish(code: number): void;
}

/**
 * Runs the shutdown sequence once. A second request (a signal after the parent died, or two
 * signals) is ignored while the first is running.
 */
export class ShutdownCoordinator {
	private finished = false;

	constructor(protected readonly deps: ShutdownCoordinatorDeps) {}

	get isFinished(): boolean {
		return this.finished;
	}

	async shutdown(reason: ShutdownReason): Promise<void> {
		if (this.finished) return;
		this.finished = true;
		try {
			this.deps.beforeShutdown();
			const report = await this.deps.runShutdown(createShutdownSteps(reason, this.deps.effects));
			if (report.failed.length > 0) {
				this.deps.logger.warn("Some shutdown steps failed", { failed: report.failed });
			}
		} catch (cause) {
			this.deps.logger.error("The shutdown sequence failed", { reason: messageOf(cause) });
		} finally {
			this.deps.finish(0);
		}
	}
}

const defaultIo: SidecarModeIo = {
	writeError: (text) => process.stderr.write(text),
	writeOut: (text) => process.stdout.write(text),
	createLogger: () =>
		createLogger({
			sink: stderrLogSink((text) => process.stderr.write(text)),
			clock: systemClock,
			level: "info",
			scope: "sidecar",
		}),
	preflight: preflightDirectories,
	installErrorHandlers: (logger) => installErrorHandlers(logger),
	startHost: (input) => startSidecarHost(input),
};

/**
 * Runs the sidecar mode. A bad environment exits 64 before anything is created; an unwritable
 * folder exits 1 naming it. A host that throws is reported by the entry point (`main.ts`).
 */
export async function runSidecarMode(
	env: Readonly<Record<string, string | undefined>>,
	args: readonly string[],
	io: SidecarModeIo = defaultIo,
): Promise<number> {
	const parsed = parseSidecarConfig(env);
	if (!parsed.ok) {
		io.writeError(`${parsed.error.message}\n`);
		return EXIT_USAGE;
	}
	const ready = await io.preflight(parsed.value);
	if (!ready.ok) {
		io.writeError(`${ready.error.message}\n`);
		return EXIT_START_FAILED;
	}
	const logger = io.createLogger();
	const removeErrorHandlers = io.installErrorHandlers(logger);
	try {
		return await io.startHost({
			config: parsed.value,
			env,
			args,
			logger,
			writeOut: io.writeOut,
		});
	} finally {
		removeErrorHandlers();
	}
}

/** The app connection while the peer is being built. Calls reach the peer once it exists. */
class DelegatingApp implements SidecarToApp {
	private peer: RpcPeer | null = null;

	setPeer(peer: RpcPeer): void {
		this.peer = peer;
	}

	get connected(): boolean {
		return this.current().connected;
	}

	request<K extends SidecarToAppRequest>(
		method: K,
		params: SidecarToAppRequestParams<K>,
		options?: { timeoutMs?: number },
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		return this.current().request(method, params, options);
	}

	notify<K extends SidecarToAppNotification>(
		method: K,
		params: SidecarToAppNotificationParams<K>,
	): boolean {
		return this.current().notify(method, params);
	}

	onAttach(listener: () => void): () => void {
		return this.current().onAttach(listener);
	}

	onDetach(listener: () => void): () => void {
		return this.current().onDetach(listener);
	}

	private current(): RpcPeer {
		if (this.peer === null) throw new Error("The sidecar's app connection is not built yet");
		return this.peer;
	}
}

/**
 * Drops the model cache and then tells the app about a new agent list. The cache must go first:
 * a new agent version can add models, and the app may ask for them as soon as it sees the change.
 */
export function announceAgentInstalls(
	deps: {
		models: { invalidate(): void };
		app: Pick<SidecarToApp, "notify">;
		logger: Logger;
	},
	installs: AgentInstall[],
): void {
	deps.models.invalidate();
	if (!deps.app.notify("agentInstallsChanged", { agents: installs })) {
		deps.logger.debug("Agent detection changed while the app was away", {
			agents: installs.length,
		});
	}
}

/**
 * Builds the whole agent host in dependency order and runs it until a signal or a vanished parent
 * stops it. It is a parameter of `runSidecarMode`, so a test never has to build a real one.
 */
export async function startSidecarHost(input: SidecarHostInput): Promise<number> {
	const { config, env, logger, writeOut } = input;
	const clock = systemClock;
	const ids = cryptoIds;
	const queue = new KeyedSerialQueue();
	const app = new DelegatingApp();
	// Pinned once, so a later environment change cannot move the transcript path.
	const hasTranscript = createTranscriptCheck(claudeConfigDir(env));
	const runShutdown = (steps: readonly ShutdownStep[]): Promise<ShutdownReport> =>
		runShutdownSteps(steps, {
			logger,
			timeout: (ms) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const done = new Promise<"timeout">((resolve) => {
					timer = setTimeout(() => resolve("timeout"), ms);
				});
				return {
					done,
					cancel: () => {
						if (timer !== undefined) clearTimeout(timer);
					},
				};
			},
		});

	const outbox = new FileEventOutbox({
		storage: createOutboxStorage(config.outboxRoot),
		queue,
		clock,
		logger,
	});
	const processes = new AgentProcessManager({ clock, logger });
	const publisher = new BatchingEventPublisher({
		outbox,
		app,
		clock,
		logger,
		sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
	});
	const liveState = new LiveStateStore({
		app,
		flushed: (sessionId) => publisher.flush(sessionId),
	});
	reportWriteFailures({ publisher, liveState });
	const interactions = new SessionInteractionBroker({ app, liveState, clock, ids, logger });
	const backend = new RpcAppToolBackend({ app, interactions, logger });
	const bridge = new AppToolsBridge({
		backend,
		tokens: createTokenSource(),
		logger,
		makeTempDir: (prefix) => mkdirTemp(prefix),
	});
	let bridgeEndpoint: BridgeEndpoint | null = null;

	const runners = createRunnerRegistry({
		config,
		env,
		logger,
		clock,
		ids,
		hasTranscript,
		appTools: backend,
		bridge,
		endpoint: () => bridgeEndpoint,
	});
	const models = new RunnerModelCatalog({ runners, logger, clock });
	const shellEnv = createShellEnvProvider(env, logger);
	const agents = new DefaultAgentDetector({
		runners,
		shellEnv,
		onChanged: (installs) => {
			announceAgentInstalls({ models, app, logger }, installs);
		},
		logger,
		ids,
		probe: probeCommand,
		clock,
	});
	const sessions = new DefaultSessionManager({
		app,
		runners,
		processes,
		checkpoints: new ScriptCheckpointService({
			scriptPath: path.join(config.binDir, "checkpointer.sh"),
			run: (args, options) =>
				runCheckpointer([path.join(config.binDir, "checkpointer.sh"), ...args], options),
			logger,
		}),
		prompt: new MessagePromptAssembler({
			writePullRequestStub: writePullRequestStubFile,
			files: createPromptFiles(),
			logger,
		}),
		shellEnv,
		publisher,
		liveState,
		interactions,
		queue,
		clock,
		ids,
		logger,
	});
	const handlers = buildHandlers({
		sessions,
		outbox,
		models,
		agents,
		slashCommands: new RunnerSlashCommandLister({ runners, logger }),
		mcpServers: new RunnerMcpServerLister({ runners, logger }),
		usage: new SessionUsageReader({ logger }),
		shellEnv,
		setLogLevel: (level) => logger.setLevel(level),
	});
	const peer = new RpcPeer({
		handlers: handlers.requests,
		notificationHandlers: handlers.notifications,
		logger,
	});
	app.setPeer(peer);
	const replayer = new OutboxReplayer({ outbox, app, logger });
	const socketPath = socketPathFor(tmpdir(), process.pid);
	const server = new SocketServer({ peer, logger, socketPath });

	const started = await runStartupSteps(
		[
			{
				name: "open the write-ahead event log",
				run: () => outbox.open(),
				undo: () => ({
					name: "flush events",
					run: async () => {
						for (const sessionId of outbox.sessionsWithPending()) {
							await publisher.flush(sessionId);
						}
					},
					limitMs: 10_000,
				}),
			},
			{
				name: "start the app tools bridge",
				run: async () => {
					const bridged = await bridge.start();
					if (bridged.ok) bridgeEndpoint = bridged.value;
					return bridged;
				},
				undo: () => ({ name: "close app tools bridge", run: () => bridge.stop(), limitMs: 5_000 }),
			},
			{
				name: "listen on the sidecar socket",
				run: () => server.listen(),
				undo: () => ({ name: "close socket", run: () => server.close(), limitMs: 5_000 }),
			},
		],
		{ runShutdown },
	);
	if (!started.ok) {
		logger.error("The sidecar could not start", { reason: started.error.message });
		return EXIT_START_FAILED;
	}
	const swept = await outbox.sweepIdle();
	if (!swept.ok) logger.warn("Old outbox files were not swept", { reason: swept.error.message });
	writeOut(`${handshakeLine(socketPath)}\n`);

	let finish: (code: number) => void = () => {};
	const done = new Promise<number>((resolve) => {
		finish = resolve;
	});
	const unsubscribeAttach = peer.onAttach(() => {
		void replayer.replayAll().catch((cause: unknown) => {
			logger.warn("Replaying the write-ahead log failed", { reason: messageOf(cause) });
		});
	});
	let watchdog: ParentWatchdog | null = null;
	let removeSignalHandlers: () => void = () => {};
	const coordinator = new ShutdownCoordinator({
		logger,
		effects: {
			stopAgents: (reason) => sessions.shutdown(reason),
			flushEvents: async () => {
				for (const sessionId of outbox.sessionsWithPending()) {
					await publisher.flush(sessionId);
				}
			},
			closeSocket: () => server.close(),
			closeAppToolsBridge: () => bridge.stop(),
		},
		runShutdown: (steps) => runShutdown(steps),
		beforeShutdown: () => {
			watchdog?.stop();
			unsubscribeAttach();
			removeSignalHandlers();
		},
		finish: (code) => finish(code),
	});
	watchdog = new ParentWatchdog({
		scheduler: {
			every: (ms, fn) => {
				const timer = setInterval(fn, ms);
				return () => clearInterval(timer);
			},
		},
		initialParentPid: parentPidFrom(env),
		currentParentPid: () => process.ppid,
		processes,
		onParentGone: () => {
			void coordinator.shutdown("parent_gone");
		},
		logger,
	});
	removeSignalHandlers = installSignalHandlers(logger, processSignals, () => {
		void coordinator.shutdown("signal");
	});
	watchdog.start();
	void refreshAgentInstalls({ agents, logger });
	return done;
}

function parentPidFrom(env: Readonly<Record<string, string | undefined>>): number {
	const raw = env[PARENT_PID_ENV];
	const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : process.ppid;
}

function createTokenSource(): TokenSource {
	return { newToken: () => randomBytes(32).toString("base64url") };
}

async function mkdirTemp(prefix: string): Promise<string> {
	const { mkdtemp } = await import("node:fs/promises");
	return mkdtemp(path.join(tmpdir(), prefix));
}

function currentEnvironment(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}

function createShellEnvProvider(
	env: Readonly<Record<string, string | undefined>>,
	logger: Logger,
): LoginShellEnvProvider {
	return new LoginShellEnvProvider({
		spawnText: spawnText,
		shellPath: process.env.SHELL ?? env.SHELL ?? "/bin/zsh",
		newMarker: () => `__conducted_env_${randomBytes(8).toString("hex")}__`,
		logger,
	});
}

/** Timers for the runner's settlement watchdog. */
export function createScheduler(): Scheduler {
	return {
		after(ms, fn) {
			const timer = setTimeout(fn, ms);
			return () => clearTimeout(timer);
		},
	};
}

/** Reads the file facts prompt assembly needs, straight from the file system. */
export function createPromptFiles(): PromptFiles {
	return {
		async size(target) {
			try {
				return (await stat(target)).size;
			} catch {
				return null;
			}
		},
		async readText(target) {
			try {
				return ok(await readFile(target, "utf8"));
			} catch (cause) {
				return err(
					appError(
						"prompt_file_read_failed",
						`Could not read ${target}: ${messageOf(cause)}`,
						cause,
					),
				);
			}
		},
	};
}

/** Runs checkpointer.sh for one request. */
async function runCheckpointer(
	args: readonly string[],
	options: { cwd: string; timeoutMs: number; killGraceMs: number },
): Promise<{ exitCode: number; stdout: string }> {
	const child = Bun.spawn({
		cmd: [...args],
		cwd: options.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	});
	const timer = setTimeout(() => child.kill(), options.timeoutMs);
	const killTimer = setTimeout(
		() => child.kill("SIGKILL"),
		options.timeoutMs + options.killGraceMs,
	);
	try {
		const stdout = await new Response(child.stdout).text();
		const exitCode = await child.exited;
		return { exitCode: exitCode ?? -1, stdout };
	} finally {
		clearTimeout(timer);
		clearTimeout(killTimer);
	}
}

function createOutboxStorage(root: string): OutboxStorage {
	return {
		async list() {
			try {
				const { readdir } = await import("node:fs/promises");
				await mkdir(root, { recursive: true, mode: 0o700 });
				return ok(await readdir(root));
			} catch (cause) {
				return err(appError("outbox_list_failed", messageOf(cause), cause));
			}
		},
		async read(fileName) {
			try {
				return ok(await readFile(path.join(root, fileName), "utf8"));
			} catch (cause) {
				if (isMissing(cause)) return ok(null);
				return err(appError("outbox_read_failed", messageOf(cause), cause));
			}
		},
		async writeAtomic(fileName, text) {
			const target = path.join(root, fileName);
			const temp = `${target}.${process.pid}.tmp`;
			try {
				await mkdir(root, { recursive: true, mode: 0o700 });
				const handle = await open(temp, "w", 0o600);
				await handle.writeFile(text);
				await handle.sync();
				await handle.close();
				await rename(temp, target);
				return ok(undefined);
			} catch (cause) {
				await rm(temp, { force: true }).catch(() => {});
				return err(appError("outbox_write_failed", messageOf(cause), cause));
			}
		},
		async moveToTrash(fileName) {
			try {
				const child = Bun.spawn({ cmd: ["trash", path.join(root, fileName)], stderr: "pipe" });
				if ((await child.exited) !== 0) {
					return err(appError("trash_failed", `trash refused ${fileName}`));
				}
				return ok(undefined);
			} catch (cause) {
				return err(appError("trash_failed", messageOf(cause), cause));
			}
		},
		async cleanTempFiles() {
			try {
				const { readdir } = await import("node:fs/promises");
				const names = await readdir(root);
				let moved = 0;
				for (const name of names) {
					if (!name.endsWith(".tmp")) continue;
					const child = Bun.spawn({ cmd: ["trash", path.join(root, name)], stderr: "pipe" });
					if ((await child.exited) === 0) moved += 1;
				}
				return ok(moved);
			} catch (cause) {
				return err(appError("outbox_clean_failed", messageOf(cause), cause));
			}
		},
	};
}

function isMissing(cause: unknown): boolean {
	return (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		(cause as { code?: string }).code === "ENOENT"
	);
}

/** The ports every runner shares. */
function commonRunnerDeps(
	env: Readonly<Record<string, string | undefined>>,
	logger: Logger,
): RunnerCommonDeps {
	return {
		logger,
		clock: systemClock,
		ids: cryptoIds,
		probe: probeCommand,
		findExecutable: findExecutable(env),
	};
}

/** How long a probe may ignore SIGTERM before it is killed outright. */
export const PROBE_KILL_GRACE_MS = 500;

/**
 * Runs a short command for a probe. A program that ignores SIGTERM is killed after a short grace,
 * so a child that keeps its pipes open cannot hang the read (claude-runner 8: probes have a
 * timeout).
 */
export const probeCommand: ProbeCommand = async (command, args, options) => {
	try {
		const child = Bun.spawn({
			cmd: [command, ...args],
			cwd: options.cwd,
			env: options.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const timer = setTimeout(() => child.kill(), options.timeoutMs);
		const killTimer = setTimeout(
			() => child.kill("SIGKILL"),
			options.timeoutMs + PROBE_KILL_GRACE_MS,
		);
		try {
			const [stdout, stderr] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			const exitCode = await child.exited;
			return ok({ stdout, stderr, exitCode: exitCode ?? -1 });
		} finally {
			clearTimeout(timer);
			clearTimeout(killTimer);
		}
	} catch (cause) {
		return err(appError("probe_failed", messageOf(cause), cause));
	}
};

function findExecutable(env: Readonly<Record<string, string | undefined>>): FindExecutable {
	return async (name, searchEnv) => {
		const pathValue = searchEnv.PATH ?? env.PATH ?? "";
		for (const folder of pathValue.split(":")) {
			if (folder === "") continue;
			const candidate = path.join(folder, name);
			try {
				await access(candidate, 1);
				return candidate;
			} catch {
				// Try the next folder.
			}
		}
		return null;
	};
}

function createRunnerRegistry(input: {
	config: SidecarConfig;
	env: Readonly<Record<string, string | undefined>>;
	logger: Logger;
	clock: typeof systemClock;
	ids: typeof cryptoIds;
	hasTranscript(sessionId: SessionId, cwd: string): Promise<boolean>;
	appTools: RpcAppToolBackend;
	bridge: AppToolsBridge;
	endpoint: () => BridgeEndpoint | null;
}): RunnerRegistry {
	const common = commonRunnerDeps(input.env, input.logger);
	const spawnCodex: SpawnJsonRpcChild = (options) => spawnJsonRpcChild(options);
	const spawnAcp: SpawnAcpChild = (options) => spawnAcpChild(options);
	const loadSdk: LoadCursorSdk = loadCursorSdk;
	const scheduler = createScheduler();
	const queueForCursor = new KeyedSerialQueue();
	const appToolsConfigArgs = (options: {
		sessionId: Parameters<AppToolsBridge["registerSession"]>[0];
		config: SessionConfig;
	}): readonly string[] => {
		const endpoint = input.endpoint();
		if (endpoint === null) return [];
		const token = input.bridge.registerSession(options.sessionId, options.config.appTools);
		const entry = appToolsMcpEntry({
			sidecarExecutable: process.execPath,
			sessionId: options.sessionId,
			socketPath: endpoint.socketPath,
			token,
			appTools: options.config.appTools,
		});
		const args: string[] = [
			"--config",
			`mcp_servers.${entry.name}.command=${entry.command}`,
			"--config",
			`mcp_servers.${entry.name}.args=${JSON.stringify(entry.args)}`,
		];
		for (const [key, value] of Object.entries(entry.env)) {
			args.push("--config", `mcp_servers.${entry.name}.env.${key}=${value}`);
		}
		return args;
	};

	const entries: { selector: RunnerSelector; runner: Runner }[] = [
		{
			selector: { agent: "claude" },
			runner: new ClaudeRunner({
				...common,
				query: (params) => sdkQuery(params as Parameters<typeof sdkQuery>[0]),
				appTools: input.appTools,
				translator: () => new ClaudeTranslator({ logger: input.logger }),
				hasTranscript: input.hasTranscript,
				realPath,
				newUuid: () => randomUUID(),
				scheduler,
				createCanUseTool: (deps) => new ClaudePermissionHandler(deps).canUseTool,
				createMcpServers: (options) => ({
					[APP_TOOL_SERVER]: createAppToolsServer(options),
				}),
			}),
		},
		{
			selector: { agent: "codex" },
			runner: new CodexRunner({
				...common,
				spawn: spawnCodex,
				random: () => Math.random(),
				sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
				appToolsConfigArgs: (options) => appToolsConfigArgs(options),
			}),
		},
		{
			selector: { agent: "cursor" },
			runner: new CursorRunner({
				...common,
				loadSdk,
				envLock: new EnvLock({ queue: queueForCursor, target: process.env }),
				apiKey: () => input.env.CURSOR_API_KEY,
			}),
		},
	];
	for (const acpAgent of ["opencode", "pi"] as const) {
		entries.push({
			selector: { agent: "acp", acpAgent },
			runner: new AcpRunner({
				...common,
				adapter: ACP_ADAPTERS[acpAgent],
				spawn: spawnAcp,
			}),
		});
	}
	return new MapRunnerRegistry(entries);
}

const realPath = async (target: string): Promise<string | null> => {
	try {
		return await realpath(target);
	} catch {
		return null;
	}
};

const loadCursorSdk: LoadCursorSdk = async () => {
	try {
		const specifier = "@cursor/sdk";
		const loaded = (await import(specifier)) as {
			createAgent?: unknown;
			resumeAgent?: unknown;
			default?: { createAgent?: unknown; resumeAgent?: unknown };
		};
		const candidate = (loaded.default ?? loaded) as Partial<CursorSdk>;
		if (
			typeof candidate.createAgent === "function" &&
			typeof candidate.resumeAgent === "function"
		) {
			return ok(candidate as CursorSdk);
		}
		return err(appError("cursor_sdk_missing", "Cursor's SDK is not installed."));
	} catch {
		return err(appError("cursor_sdk_missing", "Cursor's SDK is not installed."));
	}
};

function spawnJsonRpcChild(options: {
	command: string;
	args: readonly string[];
	cwd: string;
	env: Readonly<Record<string, string>>;
}): Promise<Result<JsonRpcChild, AppError>> {
	try {
		const child = Bun.spawn({
			cmd: [options.command, ...options.args],
			cwd: options.cwd,
			env: options.env,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		const lineListeners: ((line: string) => void)[] = [];
		const stderrListeners: ((text: string) => void)[] = [];
		const exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
		const decoder = new TextDecoder();
		let buffer = "";
		void (async () => {
			for await (const chunk of child.stdout) {
				buffer += decoder.decode(chunk, { stream: true });
				let index = buffer.indexOf("\n");
				while (index >= 0) {
					const line = buffer.slice(0, index);
					buffer = buffer.slice(index + 1);
					for (const listener of lineListeners) listener(line);
					index = buffer.indexOf("\n");
				}
			}
		})().catch(() => {});
		void (async () => {
			const text = await new Response(child.stderr).text();
			if (text.length > 0) for (const listener of stderrListeners) listener(text);
		})().catch(() => {});
		void child.exited.then((code) => {
			for (const listener of exitListeners) listener(code, null);
		});
		const port: JsonRpcChild = {
			writeLine: (line) => {
				child.stdin.write(`${line}\n`);
			},
			onLine: (listener) => {
				lineListeners.push(listener);
			},
			onStderr: (listener) => {
				stderrListeners.push(listener);
			},
			onExit: (listener) => {
				exitListeners.push(listener);
			},
			stop: async (graceMs) => {
				child.stdin.end();
				const timer = setTimeout(() => child.kill(), graceMs);
				await child.exited;
				clearTimeout(timer);
			},
		};
		return Promise.resolve(ok(port));
	} catch (cause) {
		return Promise.resolve(err(appError("spawn_failed", messageOf(cause), cause)));
	}
}

function spawnAcpChild(options: {
	command: string;
	args: readonly string[];
	cwd: string;
	env: Readonly<Record<string, string>>;
}): Promise<Result<AcpChild, AppError>> {
	try {
		const child = Bun.spawn({
			cmd: [options.command, ...options.args],
			cwd: options.cwd,
			env: options.env,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderrListeners: ((text: string) => void)[] = [];
		const exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
		void (async () => {
			const text = await new Response(child.stderr).text();
			if (text.length > 0) for (const listener of stderrListeners) listener(text);
		})().catch(() => {});
		void child.exited.then((code) => {
			for (const listener of exitListeners) listener(code, null);
		});
		const stdin = new WritableStream<Uint8Array>({
			write: (chunk) => {
				child.stdin.write(chunk);
			},
			close: () => {
				child.stdin.end();
			},
		});
		const port: AcpChild = {
			stdin,
			stdout: child.stdout,
			onStderr: (listener) => {
				stderrListeners.push(listener);
			},
			onExit: (listener) => {
				exitListeners.push(listener);
			},
			stop: async (graceMs) => {
				child.stdin.end();
				const timer = setTimeout(() => child.kill(), graceMs);
				await child.exited;
				clearTimeout(timer);
			},
		};
		return Promise.resolve(ok(port));
	} catch (cause) {
		return Promise.resolve(err(appError("spawn_failed", messageOf(cause), cause)));
	}
}

/** Runs a login-shell capture command and returns its stdout. */
async function spawnText(
	command: { command: string; args: string[] },
	options: { timeoutMs: number },
): Promise<Result<string, AppError>> {
	const result = await probeCommand(command.command, command.args, {
		env: currentEnvironment(),
		timeoutMs: options.timeoutMs,
	});
	if (!result.ok) return result;
	if (result.value.exitCode !== 0) {
		return err(
			appError(
				"shell_capture_failed",
				`${command.command} exited with ${result.value.exitCode}: ${result.value.stderr}`,
			),
		);
	}
	return ok(result.value.stdout);
}
