/**
 * @feature SIDE-01 Entry point and modes: the "sidecar" mode
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: starting the agent host. It is the composition root: it imports the real process, file,
 * socket and environment edges from `adapters/`, wires them, and passes them to the modules. It
 * builds nothing that touches `node:fs`, `Bun.spawn`, a socket or `process.env` itself. That
 * includes the slash-command cache, built over the folder from `config.ts` (SIDE-22).
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 and B1 and sessions.md sections 0, 5
 * and 8. Startup order:
 *  1. read the settings from the environment (config.ts); a bad value prints a message and exits 64
 *  2. create the logger (logging/logger.ts) writing one redacted JSON object per line to stderr,
 *     with repeated error lines folded and console calls rerouted into it; the Rust launcher writes
 *     that stderr to `<app data>/logs/sidecar-<pid>.log` (routing it into the app log files with a
 *     sidecar tag, D026, is not built)
 *  3. capture the login-shell environment (shell-env) in the background; it is needed by the first
 *     agent start, not before
 *  4. open the write-ahead log (outbox/); a failure is fatal: exit 1 with the reason. Conductor
 *     continues without a backup after 1 s; we do not, because the log is what makes delivery safe
 *  5. build the runners, process manager, session manager, interaction broker, publisher and the
 *     app tools backend and bridge
 *  6. start the app tools bridge, then listen on the Unix socket (rpc/server.ts)
 *  7. install one SIGINT and one SIGTERM handler that logs under SIGNAL and starts the graceful
 *     shutdown, and only then print SOCKET_PATH=<path> as one line on stdout, so a stop sent right
 *     after the handshake is always handled; then start the parent watchdog (watchdog.ts: the
 *     parent check and the idle sweep run on separate 2-second timers), install the
 *     uncaughtException and unhandledRejection handlers (log, do not exit), and ask the agent
 *     detector for the current list; a detection failure is logged and never fails the start
 *  8. when the app attaches: replay the write-ahead log and resend the open interactions. The
 *     agent list is sent when detection changes, and the app reads it with getAgentInstalls
 * Must handle: a second sidecar already running for the same app (the launcher kills orphans; the
 * socket path includes the pid, so two never clash), startup steps that fail halfway (the bridge
 * and the socket, once started, are stopped through the shutdown steps; the outbox has no close,
 * and its pending events stay durable for the next start), and stdout carrying only handshake lines
 * (logs go to stderr).
 * Test first: parseSidecarConfig is tested in config.test.ts; here, a start with an unwritable
 * outbox directory exits with code 1 and a message that names the directory.
 * Covered by a real process: sidecar-mode.host.test.ts starts the host on a temporary socket,
 * makes one request, checks the app tools bridge folder and stops it with SIGTERM.
 * The app tools reach Codex, ACP and Cursor agents from here: each agent start registers the chat's
 * bridge token and its session's dispose gives it back; an agent cannot start while the bridge is
 * down (an error value, never an agent without its tools); a Codex config of the user's or the
 * repository's that already defines the reserved server name keeps ours out (tools/mcp-launch.ts).
 * Our design choice: the entry only dispatches. All behaviour lives in modes/, so tests call the
 * mode functions without starting a process. The host itself is injected, so a test starts a
 * fake host without touching a real socket. `composeSidecar` builds every module from the outside
 * world it is given (`SidecarPorts`): the host passes the real processes, files and SDK, and the
 * join test (`s1-sidecar.join.test.ts`) passes scripted ones, so it drives this wiring itself.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import {
	type AgentInstall,
	APP_TOOL_SERVER,
	type SidecarToAppNotification,
	type SidecarToAppRequest,
} from "@conducted/protocol";
import {
	type AppError,
	appError,
	type Clock,
	createKeyedQueue,
	cryptoIds,
	type IdSource,
	messageOf,
	ok,
	type Result,
	type SessionId,
	systemClock,
} from "@conducted/shared";
import {
	createLoginShellEnvProvider,
	createProcessEnvironment,
	newEnvironmentMarker,
	nodeProcessFacts,
	PARENT_PID_ENV,
	type ProcessFacts,
} from "../adapters/environment.ts";
import { createNodeFilesAdapters } from "../adapters/files.ts";
import { createNodeMemoryProbePorts } from "../adapters/memory.ts";
import {
	bunSpawnProbe,
	createChildSpawners,
	createIntervalScheduler,
	createProbeCommand,
	createScheduler,
	createSleep,
	createSpawnText,
	createTimeout,
	nodeProcessHooks,
	nodeSignals,
	nodeStandardStreams,
	nodeTimers,
	type ProcessErrorHooks,
	type ShutdownSignal,
	type SignalPort,
} from "../adapters/process.ts";
import { createNodeSocketAdapters } from "../adapters/sockets.ts";
import {
	type RunCheckpointer,
	ScriptCheckpointService,
} from "../checkpoints/checkpoint-service.ts";
import { runCheckpointer } from "../checkpoints/run-checkpointer.ts";
import { parseSidecarConfig, type SidecarConfig } from "../config.ts";
import { EXIT_START_FAILED, EXIT_USAGE } from "../exit-codes.ts";
import { createLogger, type Logger, type LogSink, redactRecord } from "../logging/logger.ts";
import { type AgentDetector, DefaultAgentDetector } from "../models/agent-detection.ts";
import { AgentProgramChoices } from "../models/agent-programs.ts";
import { RunnerModelCatalog } from "../models/catalog.ts";
import { createNodeCompletionsFiles, FileCompletionsCache } from "../models/completions-cache.ts";
import { RunnerMcpServerLister, RunnerSlashCommandLister } from "../models/slash-and-mcp.ts";
import { SessionUsageReader } from "../models/usage.ts";
import { FileEventOutbox } from "../outbox/event-outbox.ts";
import { createOutboxStorage } from "../outbox/node-storage.ts";
import type { OutboxStorage } from "../outbox/outbox-file.ts";
import { OutboxReplayer } from "../outbox/replay.ts";
import { AgentProcessManager } from "../process/process-manager.ts";
import { startChild } from "../process/spawn-child.ts";
import { MessagePromptAssembler } from "../prompt/assemble.ts";
import { writePullRequestStubFile } from "../prompt/pull-request-stub.ts";
import { buildHandlers } from "../rpc/handlers.ts";
import { RpcPeer } from "../rpc/peer.ts";
import { handshakeLine, SocketServer } from "../rpc/server.ts";
import type {
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "../rpc/types.ts";
import type { SpawnAcpChild } from "../runners/acp/acp-client.ts";
import { type AcpAppTools, AcpRunner } from "../runners/acp/acp-runner.ts";
import { ACP_ADAPTERS } from "../runners/acp/adapters/registry.ts";
import { ClaudeRunner, type ClaudeRunnerDeps } from "../runners/claude/claude-runner.ts";
import { ClaudePermissionHandler } from "../runners/claude/permission-handler.ts";
import {
	claudeConfigDir,
	createTranscriptCheck,
	createUserMessageReader,
} from "../runners/claude/transcript.ts";
import { ClaudeTranslator } from "../runners/claude/translate.ts";
import type { Scheduler } from "../runners/claude/turn-tracker.ts";
import type { SpawnJsonRpcChild } from "../runners/codex/app-server-client.ts";
import { type CodexAppTools, CodexRunner } from "../runners/codex/codex-runner.ts";
import { type CursorAppTools, CursorRunner } from "../runners/cursor/cursor-runner.ts";
import type { CursorSdkLoader } from "../runners/cursor/cursor-sdk.ts";
import { EnvLock } from "../runners/cursor/env-lock.ts";
import { createCursorSdkLoader } from "../runners/cursor/load-sdk.ts";
import type { FindExecutable, ProbeCommand, RunnerCommonDeps } from "../runners/deps.ts";
import {
	createManagedProgramFinder,
	type FindManagedProgram,
	nodeManagedProgramFiles,
	shellEnvWithBinDirFirst,
} from "../runners/managed-programs.ts";
import type { RunnerRegistry, RunnerSelector } from "../runners/registry.ts";
import { MapRunnerRegistry } from "../runners/registry.ts";
import type { Runner, StartOptions } from "../runners/runner.ts";
import { BatchingEventPublisher } from "../session/event-batcher.ts";
import { SessionInteractionBroker } from "../session/interactions.ts";
import { LiveStateStore, reportWriteFailures } from "../session/live-state.ts";
import {
	DefaultSessionManager,
	type SessionManager,
	type ShutdownReason,
} from "../session/manager.ts";
import {
	createMemoryIncidentProbe,
	DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
} from "../session/memory-exhaustion.ts";
import { AgentUtilityPromptRunner } from "../session/utility-prompt.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import { runShutdownSteps, type ShutdownReport, type ShutdownStep } from "../shutdown.ts";
import { RpcAppToolBackend } from "../tools/backend.ts";
import { createAppToolsServer } from "../tools/in-process-server.ts";
import {
	acpMcpServer,
	appToolsMcpEntry,
	codexConfigDefinesServer,
	codexMcpConfig,
	type McpStdioEntry,
} from "../tools/mcp-launch.ts";
import { AppToolsBridge } from "../tools/socket-bridge.ts";
import { readTextIfPresent } from "../util/read-text.ts";
import { ParentWatchdog } from "../watchdog.ts";

export { EXIT_START_FAILED };

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
	createLogger(config: SidecarConfig): Logger;
	/** Checks that the host can write where it must. A failure names the folder. */
	preflight(config: SidecarConfig): Promise<Result<void, AppError>>;
	/** Installs the process error handlers and returns the function that removes them. */
	installErrorHandlers(logger: Logger): () => void;
	startHost: StartSidecarHost;
}

/** The environment variable that holds the Rust shell's pid (see `adapters/environment.ts`). */
export { PARENT_PID_ENV };

/**
 * A sink that writes one JSON object per line, as the Rust launcher expects (D026). Every record's
 * data is redacted first, so a secret under a secret-looking name never leaves the process.
 */
export function stderrLogSink(write: (text: string) => void): LogSink {
	return (record) => {
		write(`${JSON.stringify(redactRecord(record))}\n`);
	};
}

export type { ProcessErrorHooks };

/**
 * Logs an uncaught exception or an unhandled rejection and keeps running (sessions.md 8). The
 * sidecar is the only process that runs the user's agents; exiting would lose every chat.
 */
export function installErrorHandlers(
	logger: Logger,
	hooks: ProcessErrorHooks = nodeProcessHooks,
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

/** What a new app connection starts: the log replay, and the resend of open interactions. */
export function handleAppAttached(deps: {
	replayer: Pick<OutboxReplayer, "replayAll">;
	sessions: Pick<SessionManager, "onAppAttached">;
	logger: Logger;
}): void {
	void deps.replayer.replayAll().catch((cause: unknown) => {
		deps.logger.warn("Replaying the write-ahead log failed", { reason: messageOf(cause) });
	});
	deps.sessions.onAppAttached();
}

/** The log tag Conductor uses for the signal handlers. */
export const SIGNAL_LOG_TAG = "SIGNAL";

export type { ShutdownSignal, SignalPort };

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
 * (D007, SIDE-06). There is no HTTP server (D028); the mode flushes the logger after the host ends.
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
	/** Stops what must not run during shutdown: the watchdog and the attach listener. */
	beforeShutdown(): void;
	/**
	 * Runs once the shutdown ended, before the process finishes. The signal handlers go here, not
	 * in beforeShutdown: a second signal during a slow shutdown must still reach the coordinator
	 * and be ignored, where Node's default action would kill the process and orphan the agents.
	 */
	afterShutdown(): void;
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
			this.deps.afterShutdown();
			this.deps.finish(0);
		}
	}
}

/**
 * The mode's real effects over two output streams. Production passes the process's stdout and
 * stderr; a test passes its own, so it runs the same logger wiring: redacted JSON lines on stderr,
 * folded repeats and the console reroute.
 */
export function createDefaultIo(streams: {
	writeError(text: string): void;
	writeOut(text: string): void;
}): SidecarModeIo {
	const files = createNodeFilesAdapters({});
	return {
		writeError: (text) => streams.writeError(text),
		writeOut: (text) => streams.writeOut(text),
		createLogger: (config) =>
			createLogger({
				sink: stderrLogSink((text) => streams.writeError(text)),
				clock: systemClock,
				level: config.logLevel,
				scope: "sidecar",
				foldRepeats: true,
				rerouteConsole: true,
			}),
		preflight: (config) => files.preflight(config),
		installErrorHandlers: (logger) => installErrorHandlers(logger),
		startHost: (input) => startSidecarHost(input),
	};
}

const defaultIo: SidecarModeIo = createDefaultIo(nodeStandardStreams);

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
	const logger = io.createLogger(parsed.value);
	logger.info("The sidecar is starting", {
		appVersion: parsed.value.appVersion,
		logLevel: parsed.value.logLevel,
	});
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
		logger.dispose?.();
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
	const app = new DelegatingApp();
	const environment = createProcessEnvironment(nodeProcessFacts);
	const probe = createProbeCommand(bunSpawnProbe, nodeTimers);
	const { spawnJsonRpcChild, spawnAcpChild } = createChildSpawners(startChild, logger);
	const files = createNodeFilesAdapters({ fallbackPath: env.PATH });
	const sockets = createNodeSocketAdapters();
	const runShutdown = (steps: readonly ShutdownStep[]): Promise<ShutdownReport> =>
		runShutdownSteps(steps, { logger, timeout: createTimeout(nodeTimers) });

	const host = composeSidecar(config, {
		app,
		query: (params) => sdkQuery(params as Parameters<typeof sdkQuery>[0]),
		spawnCodex: spawnJsonRpcChild,
		spawnAcp: spawnAcpChild,
		// Cursor's SDK is imported from app data at the first Cursor chat (runners/cursor/load-sdk.ts).
		importCursorSdk: (entry) => import(entry),
		probe,
		findExecutable: files.findExecutable,
		shellEnv: createLoginShellEnvProvider({
			launcherEnv: env,
			logger,
			notifyFailure: (failure) => {
				app.notify("shellEnvFailed", failure);
			},
			spawnText: createSpawnText(probe, environment.snapshot),
			newMarker: newEnvironmentMarker,
		}),
		runCheckpointer,
		outboxStorage: createOutboxStorage(config.outboxRoot),
		makeTempDir: files.makeTempDir,
		readText: readTextIfPresent,
		sidecarExecutable: environment.execPath,
		// Pinned once, so a later environment change cannot move the transcript path.
		hasTranscript: createTranscriptCheck(claudeConfigDir(env)),
		readUserMessageText: createUserMessageReader(claudeConfigDir(env)),
		newToken: () => randomBytes(32).toString("base64url"),
		clock: systemClock,
		ids: cryptoIds,
		logger,
	});
	const { outbox, publisher, processes, bridge, sessions, handlers, agents } = host;
	const peer = new RpcPeer({
		handlers: handlers.requests,
		notificationHandlers: handlers.notifications,
		logger,
	});
	app.setPeer(peer);
	const replayer = new OutboxReplayer({ outbox, app, logger });
	const socketPath = sockets.path();
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
				run: () => bridge.start(),
				undo: () => ({
					name: "close app tools bridge",
					run: () => bridge.stop(),
					limitMs: 5_000,
				}),
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

	let finish: (code: number) => void = () => {};
	const done = new Promise<number>((resolve) => {
		finish = resolve;
	});
	const unsubscribeAttach = peer.onAttach(() => handleAppAttached({ replayer, sessions, logger }));
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
		},
		afterShutdown: () => removeSignalHandlers(),
		finish: (code) => finish(code),
	});
	watchdog = new ParentWatchdog({
		scheduler: createIntervalScheduler(nodeTimers),
		initialParentPid: environment.parentPid(env),
		currentParentPid: () => environment.ppid,
		processes,
		onParentGone: () => {
			void coordinator.shutdown("parent_gone");
		},
		logger,
	});
	removeSignalHandlers = installSignalHandlers(logger, nodeSignals, () => {
		void coordinator.shutdown("signal");
	});
	// Ready only now: a SIGTERM sent right after the handshake must reach the handler above, or the
	// signal's default action ends the process with the bridge folder and socket left behind.
	writeOut(`${handshakeLine(socketPath)}\n`);
	watchdog.start();
	void refreshAgentInstalls({ agents, logger });
	return done;
}

/**
 * The outside world the agent host talks to: processes, files, sockets, the SDK, time and ids.
 * `startSidecarHost` passes the real ones; the join test scripts them and builds the rest through
 * `composeSidecar`, so a wiring line removed here fails there.
 */
export interface SidecarPorts {
	/** The app connection. */
	app: SidecarToApp;
	/** The Claude Agent SDK's query(). */
	query: ClaudeRunnerDeps["query"];
	spawnCodex: SpawnJsonRpcChild;
	spawnAcp: SpawnAcpChild;
	/**
	 * Imports Cursor's SDK from the file the program manager installed (D083). Called at the first
	 * Cursor chat, never at startup.
	 */
	importCursorSdk(entry: string): Promise<unknown>;
	probe: ProbeCommand;
	findExecutable: FindExecutable;
	shellEnv: ShellEnvProvider;
	runCheckpointer: RunCheckpointer;
	outboxStorage: OutboxStorage;
	/** Makes a private folder in the temp folder and returns its path. */
	makeTempDir(prefix: string): Promise<string>;
	/** Reads a text file. `null` when the file does not exist. */
	readText(path: string): Promise<Result<string | null, AppError>>;
	/** The program agents start in "app-tools-mcp" mode: the sidecar itself. */
	sidecarExecutable: string;
	hasTranscript(sessionId: SessionId, cwd: string): Promise<boolean>;
	/** The text of one user message in a Claude transcript, by uuid (RC-03). */
	readUserMessageText(agentSessionId: string, cwd: string, uuid: string): Promise<string | null>;
	/** A new bridge token: 32 random bytes, base64url encoded. */
	newToken(): string;
	clock: Clock;
	ids: IdSource;
	logger: Logger;
}

/** What the composition root builds. The host starts and stops it; a test drives it. */
export interface SidecarComposition {
	runners: RunnerRegistry;
	sessions: DefaultSessionManager;
	handlers: ReturnType<typeof buildHandlers>;
	bridge: AppToolsBridge;
	outbox: FileEventOutbox;
	publisher: BatchingEventPublisher;
	processes: AgentProcessManager;
	agents: DefaultAgentDetector;
	completions: FileCompletionsCache;
}

/** The agents whose programs the app downloads and keeps (PLAT-28, D021). */
const MANAGED_AGENTS: ReadonlySet<string> = new Set(["claude", "codex"]);

/**
 * Builds every module of the host from the ports, in dependency order. Starts nothing. The process
 * facts default to this process; the join test passes the sandbox's Linux facts to drive the same
 * wiring the image runs.
 */
export function composeSidecar(
	config: SidecarConfig,
	ports: SidecarPorts,
	facts: ProcessFacts = nodeProcessFacts,
): SidecarComposition {
	const { app, clock, ids, logger } = ports;
	const files = createNodeFilesAdapters({});
	const environment = createProcessEnvironment(facts);
	const sleep = createSleep(nodeTimers);
	const queue = createKeyedQueue();
	const outbox = new FileEventOutbox({ storage: ports.outboxStorage, queue, clock, logger });
	const processes = new AgentProcessManager({ clock, logger });
	const publisher = new BatchingEventPublisher({
		outbox,
		app,
		clock,
		logger,
		sleep,
	});
	const liveState = new LiveStateStore({
		app,
		flushed: (sessionId) => publisher.flush(sessionId),
	});
	reportWriteFailures({ publisher, liveState });
	const interactions = new SessionInteractionBroker({
		app,
		liveState,
		flushed: (sessionId) => publisher.flush(sessionId),
		clock,
		ids,
		logger,
	});
	const backend = new RpcAppToolBackend({ app, interactions, logger });
	const bridge = new AppToolsBridge({
		backend,
		tokens: { newToken: ports.newToken },
		logger,
		makeTempDir: ports.makeTempDir,
	});

	// Agents find the managed gh and watchexec before any copy of their own (PLAT-35, D024).
	const shellEnv = shellEnvWithBinDirFirst(ports.shellEnv, config.binDir);
	const findManagedProgram = createManagedProgramFinder({
		binDir: config.binDir,
		agentBinariesDir: config.agentBinariesDir,
		files: nodeManagedProgramFiles,
	});
	const cursorSdk = createCursorSdkLoader({
		agentBinariesDir: config.agentBinariesDir,
		platform: environment.platform,
		cpu: environment.arch,
		readText: ports.readText,
		importModule: ports.importCursorSdk,
	});
	const runners = createRunnerRegistry({
		ports,
		appTools: backend,
		bridge,
		skillPluginDir: config.skillPluginDir,
		cursorStoreDir: config.cursorStoreDir,
		cursorSdk,
		findManagedProgram,
		realPath: files.realPath,
		scheduler: createScheduler(nodeTimers),
		sleep,
		cursorEnvironment: environment.target(),
	});
	const models = new RunnerModelCatalog({ runners, shellEnv, logger, clock });
	const utilityPrompt = new AgentUtilityPromptRunner({
		runners,
		shellEnv,
		clock,
		ids,
		logger,
	});
	const agentPrograms = new AgentProgramChoices();
	const agents = new DefaultAgentDetector({
		runners,
		shellEnv,
		executablePath: (selector) => agentPrograms.pathFor(selector),
		onChanged: (installs) => {
			announceAgentInstalls({ models, app, logger }, installs);
		},
		logger,
		ids,
		probe: ports.probe,
		clock,
		findManagedProgram: async (selector) => {
			if (MANAGED_AGENTS.has(selector.agent)) return findManagedProgram(selector.agent);
			if (selector.agent !== "cursor") return null;
			// Cursor's SDK is the app's own copy when the program manager installed it (D083).
			const located = await cursorSdk.locate();
			if (!located.ok || located.value === null) return null;
			return { path: located.value.folder, version: located.value.version };
		},
	});
	const checkpointer = path.join(config.binDir, "checkpointer.sh");
	const sessions = new DefaultSessionManager({
		app,
		runners,
		processes,
		checkpoints: new ScriptCheckpointService({
			scriptPath: checkpointer,
			run: (args, options) => ports.runCheckpointer([checkpointer, ...args], options),
			logger,
		}),
		prompt: new MessagePromptAssembler({
			writePullRequestStub: writePullRequestStubFile,
			files: files.promptFiles,
			logger,
		}),
		shellEnv,
		publisher,
		liveState,
		interactions,
		queue,
		models,
		clock,
		ids,
		logger,
		memory: createMemoryIncidentProbe({
			markerPath: config.incidentMarkerPath ?? DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
			ports: createNodeMemoryProbePorts(),
		}),
	});
	const completions = new FileCompletionsCache({
		dir: config.completionsDir,
		files: createNodeCompletionsFiles(),
		clock,
		logger,
	});
	const handlers = buildHandlers({
		sessions,
		outbox,
		models,
		agents,
		agentPrograms,
		slashCommands: new RunnerSlashCommandLister({ runners, shellEnv, logger }),
		completions,
		mcpServers: new RunnerMcpServerLister({ runners, shellEnv, logger }),
		usage: new SessionUsageReader({ logger, sessions }),
		shellEnv,
		utilityPrompt,
		setLogLevel: (level) => logger.setLevel(level),
		logger,
	});
	return {
		runners,
		sessions,
		handlers,
		bridge,
		outbox,
		publisher,
		processes,
		agents,
		completions,
	};
}

/** The Codex config files a Codex chat reads: the user's own, and the repository's. */
function codexConfigFiles(options: StartOptions): string[] {
	const files: string[] = [];
	const home =
		options.env.CODEX_HOME ?? (options.env.HOME ? path.join(options.env.HOME, ".codex") : null);
	if (home !== null) files.push(path.join(home, "config.toml"));
	files.push(path.join(options.workspace.workspacePath, ".codex", "config.toml"));
	return files;
}

function createRunnerRegistry(input: {
	ports: SidecarPorts;
	appTools: RpcAppToolBackend;
	bridge: AppToolsBridge;
	/** The app's bundled skill plugin folder, when the build has one (AGENT-18). */
	skillPluginDir: string | undefined;
	/** The root of the Cursor SDK's local run stores (AGENT-09). */
	cursorStoreDir: string;
	/** Finds and loads the Cursor SDK the program manager installed (AGENT-09). */
	cursorSdk: CursorSdkLoader;
	/** The app's managed copies of the agent programs (PLAT-28). */
	findManagedProgram: FindManagedProgram;
	/** Resolves a path, or null when it does not exist. */
	realPath(target: string): Promise<string | null>;
	/** Timers for the Claude runner's settlement watchdog. */
	scheduler: Scheduler;
	/** Waits between Codex delivery attempts. */
	sleep(ms: number): Promise<void>;
	/** The live environment the Cursor SDK's lock writes into. */
	cursorEnvironment: Readonly<Record<string, string | undefined>>;
}): RunnerRegistry {
	const { ports, bridge } = input;
	const { logger } = ports;
	const common: RunnerCommonDeps = {
		logger,
		clock: ports.clock,
		ids: ports.ids,
		probe: ports.probe,
		findExecutable: ports.findExecutable,
		findManagedProgram: input.findManagedProgram,
	};
	const queueForCursor = createKeyedQueue();
	/**
	 * Registers the chat's token and builds the helper entry. The release ends the token when the
	 * agent session is disposed. A bridge that is not listening is an error, never an agent that
	 * quietly starts without its tools.
	 */
	const appToolsEntry = (options: StartOptions): { entry: McpStdioEntry; release(): void } => {
		const endpoint = bridge.currentEndpoint;
		if (endpoint === null) {
			throw appError(
				"app_tools_bridge_down",
				"The app tools bridge is not running, so the agent cannot start. Restart the app and try again.",
			);
		}
		const token = bridge.registerSession(options.sessionId, options.config.appTools);
		return {
			entry: appToolsMcpEntry({
				sidecarExecutable: ports.sidecarExecutable,
				sessionId: options.sessionId,
				socketPath: endpoint.socketPath,
				workspaceDir: options.workspace.workspacePath,
				token,
				appTools: options.config.appTools,
			}),
			release: () => bridge.unregisterSession(options.sessionId, token),
		};
	};
	const codexAppTools = async (options: StartOptions): Promise<CodexAppTools> => {
		for (const file of codexConfigFiles(options)) {
			const text = await ports.readText(file);
			if (!text.ok) throw text.error;
			if (text.value !== null && codexConfigDefinesServer(text.value, APP_TOOL_SERVER)) {
				logger.warn(
					"A Codex config already defines the app tools server; this chat starts without it",
					{
						file,
						server: APP_TOOL_SERVER,
					},
				);
				return { args: [], env: {}, release: () => {} };
			}
		}
		const { entry, release } = appToolsEntry(options);
		const config = codexMcpConfig(entry);
		return { args: config.args, env: config.env, release };
	};
	const acpAppTools = async (options: StartOptions): Promise<AcpAppTools> => {
		const { entry, release } = appToolsEntry(options);
		return { servers: [acpMcpServer(entry)], release };
	};
	const cursorAppTools = async (options: StartOptions): Promise<CursorAppTools> => {
		const { entry, release } = appToolsEntry(options);
		return { server: { command: entry.command, args: entry.args, env: entry.env }, release };
	};

	const entries: { selector: RunnerSelector; runner: Runner }[] = [
		{
			selector: { agent: "claude" },
			runner: new ClaudeRunner({
				...common,
				query: ports.query,
				appTools: input.appTools,
				skillPluginDir: input.skillPluginDir,
				translator: () => new ClaudeTranslator({ logger }),
				hasTranscript: ports.hasTranscript,
				readUserMessageText: ports.readUserMessageText,
				realPath: input.realPath,
				newUuid: () => ports.ids.uuid(),
				scheduler: input.scheduler,
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
				spawn: ports.spawnCodex,
				random: () => Math.random(),
				sleep: input.sleep,
				appToolsConfig: codexAppTools,
			}),
		},
		{
			selector: { agent: "cursor" },
			runner: new CursorRunner({
				...common,
				sdk: input.cursorSdk,
				envLock: new EnvLock({ queue: queueForCursor, target: input.cursorEnvironment }),
				storeRoot: input.cursorStoreDir,
				appToolsServer: cursorAppTools,
			}),
		},
	];
	for (const acpAgent of ["opencode", "pi"] as const) {
		entries.push({
			selector: { agent: "acp", acpAgent },
			runner: new AcpRunner({
				...common,
				adapter: ACP_ADAPTERS[acpAgent],
				spawn: ports.spawnAcp,
				appToolsServers: acpAppTools,
			}),
		});
	}
	return new MapRunnerRegistry(entries);
}
