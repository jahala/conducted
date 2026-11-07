/**
 * @feature SIDE-25 Sidecar adapters in their own edge modules
 * @feature SIDE-01 Entry point and modes
 * Owns: the sidecar's process edges: running a short probe, starting the long-lived Codex and ACP
 * children, the standard output streams, the process error events and signals, and the timers
 * (scheduling, the shutdown time limit, the watchdog interval and a sleep).
 * Behaviour: research/conductor/native-and-sidecar-map.md B1 and sessions.md section 8. A probe
 * that ignores SIGTERM is killed after a short grace, so a child that keeps its pipes open cannot
 * hang the read. The child spawners are thin views over `process/spawn-child.ts`.
 * Must handle: a probe whose program ignores SIGTERM (it is killed and the read ends), a child
 * whose stdout arrives in pieces (lines are joined before a listener sees them), a cancelled timer
 * (the callback never runs), and a second signal (the caller removes every listener it installed).
 * Test first: a probe that ignores SIGTERM is killed after the grace and does not hang.
 * Our design choice: every factory takes the spawn, the timer source, the streams or the logger it
 * uses, so the composition root (`modes/sidecar-mode.ts`) only wires real ones.
 */
import type { AppError, Result } from "@conducted/shared";
import { appError, err, messageOf, ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { startChild } from "../process/spawn-child.ts";
import type { AcpChild, SpawnAcpChild } from "../runners/acp/acp-client.ts";
import type { Scheduler } from "../runners/claude/turn-tracker.ts";
import type { JsonRpcChild, SpawnJsonRpcChild } from "../runners/codex/app-server-client.ts";
import type { ProbeCommand } from "../runners/deps.ts";
import type { SpawnText } from "../shell-env/capture.ts";
import type { Timer } from "../shutdown.ts";
import type { IntervalScheduler } from "../watchdog.ts";

/** How long a probe may ignore SIGTERM before it is killed outright. */
export const PROBE_KILL_GRACE_MS = 500;

/** The shortest view of a spawned probe the adapter needs. */
export interface ProbeChild {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number | null>;
	kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

export interface ProbeSpawnOptions {
	cmd: string[];
	cwd: string | undefined;
	env: Readonly<Record<string, string>>;
	stdin: "ignore";
	stdout: "pipe";
	stderr: "pipe";
}

export type SpawnProbeProcess = (options: ProbeSpawnOptions) => ProbeChild;

/** The real spawn. Every probe option is one Bun accepts. */
export const bunSpawnProbe: SpawnProbeProcess = (options) =>
	Bun.spawn({ ...options, env: options.env as Record<string, string> }) as unknown as ProbeChild;

/**
 * Runs a short command for a probe. A program that ignores SIGTERM is killed after a short grace,
 * so a child that keeps its pipes open cannot hang the read (claude-runner 8: probes have a
 * timeout).
 */
export function createProbeCommand(spawn: SpawnProbeProcess, timers: Timers): ProbeCommand {
	return async (command, args, options) => {
		try {
			const child = spawn({
				cmd: [command, ...args],
				cwd: options.cwd,
				env: options.env,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			const timer = timers.setTimeout(() => child.kill(), options.timeoutMs);
			const killTimer = timers.setTimeout(
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
				timers.clearTimeout(timer);
				timers.clearTimeout(killTimer);
			}
		} catch (cause) {
			return err(appError("probe_failed", messageOf(cause), cause));
		}
	};
}

export interface ChildSpawners {
	/** Starts a Codex app-server child and reads its stdout as JSON-RPC lines. */
	spawnJsonRpcChild: SpawnJsonRpcChild;
	/** Starts an ACP agent child and exposes its stdio as web streams. */
	spawnAcpChild: SpawnAcpChild;
}

/**
 * Builds the two child spawn ports over one starter, so stderr, exit and stop rules exist once
 * (`process/spawn-child.ts`). The composition root passes `startChild` and its logger.
 */
export function createChildSpawners(start: typeof startChild, logger: Logger): ChildSpawners {
	return {
		spawnJsonRpcChild: (options) => spawnJsonRpcChild(start, logger, options),
		spawnAcpChild: (options) => spawnAcpChild(start, logger, options),
	};
}

function spawnJsonRpcChild(
	start: typeof startChild,
	logger: Logger,
	options: {
		command: string;
		args: readonly string[];
		cwd: string;
		env: Readonly<Record<string, string>>;
	},
): Promise<Result<JsonRpcChild, AppError>> {
	const started = start({ ...options, logger });
	if (!started.ok) return Promise.resolve(started);
	const child = started.value;
	const lineListeners: ((line: string) => void)[] = [];
	void (async () => {
		const decoder = new TextDecoder();
		let buffer = "";
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
	})().catch((cause: unknown) => {
		logger.warn("Could not read a child's stdout", {
			command: options.command,
			reason: messageOf(cause),
		});
	});
	return Promise.resolve(
		ok({
			writeLine: (line) => child.write(`${line}\n`),
			onLine: (listener) => {
				lineListeners.push(listener);
			},
			onStderr: (listener) => child.onStderr(listener),
			onExit: (listener) => child.onExit(listener),
			stop: (graceMs) => child.stop(graceMs),
		}),
	);
}

function spawnAcpChild(
	start: typeof startChild,
	logger: Logger,
	options: {
		command: string;
		args: readonly string[];
		cwd: string;
		env: Readonly<Record<string, string>>;
	},
): Promise<Result<AcpChild, AppError>> {
	const started = start({ ...options, logger });
	if (!started.ok) return Promise.resolve(started);
	const child = started.value;
	const stdin = new WritableStream<Uint8Array>({
		write: (chunk) => child.write(chunk),
		close: () => child.endInput(),
	});
	return Promise.resolve(
		ok({
			stdin,
			stdout: child.stdout,
			onStderr: (listener) => child.onStderr(listener),
			onExit: (listener) => child.onExit(listener),
			stop: (graceMs) => child.stop(graceMs),
		}),
	);
}

/** Runs a login-shell capture command and returns its stdout. */
export function createSpawnText(
	probe: ProbeCommand,
	environment: () => Readonly<Record<string, string | undefined>>,
): SpawnText {
	return async (command, options) => {
		const result = await probe(command.command, command.args, {
			env: stringRecord(environment()),
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
	};
}

function stringRecord(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}

/** The timer operations the process adapters need. */
export interface Timers {
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	setInterval(callback: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

/** The real timers. */
export const nodeTimers: Timers = {
	setTimeout: (callback, ms) => setTimeout(callback, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	setInterval: (callback, ms) => setInterval(callback, ms),
	clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** The scheduler the Claude runner's settlement watchdog uses. */
export function createScheduler(timers: Timers): Scheduler {
	return {
		after(ms, fn) {
			const timer = timers.setTimeout(fn, ms);
			return () => timers.clearTimeout(timer);
		},
	};
}

/** The shutdown time limit: one timer per shutdown step. */
export function createTimeout(timers: Timers): Timer {
	return (ms) => {
		let timer: unknown;
		const done = new Promise<"timeout">((resolve) => {
			timer = timers.setTimeout(() => resolve("timeout"), ms);
		});
		return {
			done,
			cancel: () => timers.clearTimeout(timer),
		};
	};
}

/** The interval scheduler the parent watchdog uses. */
export function createIntervalScheduler(timers: Timers): IntervalScheduler {
	return {
		every(ms, fn) {
			const timer = timers.setInterval(fn, ms);
			return () => timers.clearInterval(timer);
		},
	};
}

/** Waits `ms`, for a backoff between event deliveries. */
export function createSleep(timers: Timers): (ms: number) => Promise<void> {
	return (ms) => new Promise<void>((resolve) => timers.setTimeout(resolve, ms));
}

/** The sidecar's two output streams. Production writes to the process; a test passes its own. */
export interface StandardStreams {
	writeOut(text: string): void;
	writeError(text: string): void;
}

/** The real standard output and error streams. */
export const nodeStandardStreams: StandardStreams = {
	writeOut: (text) => process.stdout.write(text),
	writeError: (text) => process.stderr.write(text),
};

/** The process-level error events the mode handles. Narrow, so a test needs no real process. */
export interface ProcessErrorHooks {
	on(event: "uncaughtException", listener: (error: unknown) => void): void;
	on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
	off(event: "uncaughtException", listener: (error: unknown) => void): void;
	off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
}

/** The real process error events. */
export const nodeProcessHooks: ProcessErrorHooks = {
	on: (event, listener) => process.on(event, listener),
	off: (event, listener) => process.off(event, listener),
};

export type ShutdownSignal = "SIGINT" | "SIGTERM";

/** The narrow process surface the signal handlers need, so a test passes a fake. */
export interface SignalPort {
	on(signal: ShutdownSignal, listener: () => void): void;
	off(signal: ShutdownSignal, listener: () => void): void;
}

/** The real signal surface. */
export const nodeSignals: SignalPort = {
	on: (signal, listener) => process.on(signal, listener),
	off: (signal, listener) => process.off(signal, listener),
};
