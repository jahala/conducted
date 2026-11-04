/**
 * @feature SIDE-19 Parent watchdog and graceful shutdown: shutdown steps
 * Owns: running the shutdown steps in order, so one failing step does not stop the others.
 * Behaviour: research/conductor/sessions.md sections 3 and 8: shutdown stops every agent (without a
 * checkpoint), waits up to 10 s for running turns, flushes the outbox, closes the HTTP and socket
 * servers, then exits with code 0. SIGINT, SIGTERM and a vanished parent all take this path.
 * uncaughtException and unhandledRejection are logged and do not exit.
 * Must handle: a step that throws or rejects (logged, the next step still runs), a step that takes
 * too long (each step has its own time limit, then it is abandoned and logged), a second shutdown
 * request while one runs (returns the first one's promise), and the report of which steps failed.
 * Test first: with steps [ok, throws, ok], all three run, and the report lists the second as failed.
 * Our design choice: the order is stop accepting new work, stop agents, flush events, close the
 * socket, close the logger. Conductor flushes the outbox before closing the sockets too.
 */
import type { Logger } from "./logging/logger.ts";

export interface ShutdownStep {
	name: string;
	run(): Promise<void>;
	/** Longest time this step may take, in ms. */
	limitMs: number;
}

export interface ShutdownReport {
	completed: string[];
	failed: { name: string; reason: string }[];
}

export type Timer = (ms: number) => Promise<"timeout">;

export async function runShutdownSteps(
	steps: readonly ShutdownStep[],
	deps: { logger: Logger; timeout: Timer },
): Promise<ShutdownReport> {
	const report: ShutdownReport = { completed: [], failed: [] };
	for (const step of steps) {
		try {
			const outcome = await Promise.race([
				step.run().then(() => "done" as const),
				deps.timeout(step.limitMs),
			]);
			if (outcome === "timeout") {
				const reason = `took longer than ${step.limitMs} ms`;
				deps.logger.warn(`Shutdown step ${step.name} ${reason}`);
				report.failed.push({ name: step.name, reason });
			} else {
				report.completed.push(step.name);
			}
		} catch (cause) {
			const reason = cause instanceof Error ? cause.message : String(cause);
			deps.logger.error(`Shutdown step ${step.name} failed`, { reason });
			report.failed.push({ name: step.name, reason });
		}
	}
	return report;
}
