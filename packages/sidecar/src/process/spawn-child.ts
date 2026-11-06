/**
 * @feature SIDE-01 Entry point and modes: long-lived child processes
 * Owns: starting one agent child (Codex app-server, an ACP agent) with piped stdio, passing its
 * stderr on as it arrives, reporting its exit with the signal that ended it, and stopping it in
 * three steps: close stdin, SIGTERM after a grace, SIGKILL after a second grace.
 * Behaviour: research/conductor/other-runners.md (children are stopped by closing stdin first).
 * Must handle: a child that ignores SIGTERM (it is killed, stop() resolves), a child that already
 * exited (closing its stdin may throw, which is not a failure), a stderr that is long-lived (each
 * chunk goes to the listeners at once, nothing is buffered until exit), and a read error on a
 * stream (logged, not swallowed).
 * Test first: a child that traps SIGTERM is stopped by stop(50) and its exit listener sees SIGKILL.
 * Our design choice: both spawn ports (JSON-RPC lines and ACP streams) are thin views over this one
 * helper, so the stderr, exit and stop rules exist once.
 */
import type { AppError, Result } from "@conducted/shared";
import { appError, err, messageOf, ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";

/** How long a child gets to leave after SIGTERM before SIGKILL. */
export const CHILD_KILL_GRACE_MS = 2_000;

export interface ChildProcessHandle {
	/** The child's stdout. Read it once. */
	stdout: ReadableStream<Uint8Array>;
	write(chunk: string | Uint8Array): void;
	endInput(): void;
	/** Called with each piece of stderr text as it arrives. */
	onStderr(listener: (text: string) => void): void;
	onExit(listener: (exitCode: number | null, signal: string | null) => void): void;
	/** Closes stdin, waits `graceMs`, sends SIGTERM, waits `killGraceMs`, sends SIGKILL. */
	stop(graceMs: number, killGraceMs?: number): Promise<void>;
}

export function startChild(options: {
	command: string;
	args: readonly string[];
	cwd: string;
	env: Readonly<Record<string, string>>;
	logger: Logger;
}): Result<ChildProcessHandle, AppError> {
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
			const decoder = new TextDecoder();
			for await (const chunk of child.stderr) {
				const text = decoder.decode(chunk, { stream: true });
				if (text.length > 0) for (const listener of stderrListeners) listener(text);
			}
		})().catch((cause: unknown) => {
			options.logger.warn("Could not read a child's stderr", {
				command: options.command,
				reason: messageOf(cause),
			});
		});
		void child.exited.then((code) => {
			for (const listener of exitListeners)
				listener(code, typeof child.signalCode === "string" ? child.signalCode : null);
		});
		return ok({
			stdout: child.stdout,
			write: (chunk) => {
				child.stdin.write(chunk);
			},
			endInput: () => endInput(child),
			onStderr: (listener) => {
				stderrListeners.push(listener);
			},
			onExit: (listener) => {
				exitListeners.push(listener);
			},
			stop: async (graceMs, killGraceMs = CHILD_KILL_GRACE_MS) => {
				endInput(child);
				const terminate = setTimeout(() => child.kill("SIGTERM"), graceMs);
				const kill = setTimeout(() => child.kill("SIGKILL"), graceMs + killGraceMs);
				try {
					await child.exited;
				} finally {
					clearTimeout(terminate);
					clearTimeout(kill);
				}
			},
		});
	} catch (cause) {
		return err(appError("spawn_failed", messageOf(cause), cause));
	}
}

function endInput(child: Bun.Subprocess<"pipe", "pipe", "pipe">): void {
	try {
		child.stdin.end();
	} catch {
		// A child that already exited has closed its stdin; there is nothing left to end.
	}
}
