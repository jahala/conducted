/**
 * @feature SIDE-19 Parent watchdog and graceful shutdown: shutdown steps
 * Owns: running the shutdown steps in order, so one failing step does not stop the others.
 * Behaviour: research/conductor/sessions.md sections 3 and 8: shutdown stops every agent (without
 * a checkpoint), flushes the events the app has not confirmed, closes the sidecar socket and then
 * the app tools bridge, and the process exits with code 0. SIGINT, SIGTERM and a vanished parent
 * all take this path. uncaughtException and unhandledRejection are logged and do not exit.
 * There is no HTTP server (D028) and no logger close; the outbox is a file-based write-ahead log
 * with no handle to close (D007, SIDE-06), so flushing is its only shutdown step.
 * Must handle: a step that throws or rejects (logged, the next step still runs), a step that takes
 * too long (each step has its own time limit, then it is abandoned and logged), the report of
 * which steps failed, and a timer that is cancelled once its step finishes first. The caller
 * ignores a second shutdown request while one is running.
 * Test first: with steps [ok, throws, ok], all three run, and the report lists the second as failed.
 * Our design choice: the step list lives in the composition root (sidecar-mode.ts), next to the
 * ports it closes; this module only runs a list it is given.
 */
import type { Logger } from "./logging/logger.ts";
import { messageOf } from "./util/errors.ts";

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

/** A pending time limit. Call cancel() when the step finishes first, so no timer stays behind. */
export interface TimeoutHandle {
	readonly done: Promise<"timeout">;
	cancel(): void;
}

export type Timer = (ms: number) => TimeoutHandle;

export async function runShutdownSteps(
	steps: readonly ShutdownStep[],
	deps: { logger: Logger; timeout: Timer },
): Promise<ShutdownReport> {
	const report: ShutdownReport = { completed: [], failed: [] };
	for (const step of steps) {
		let timer: TimeoutHandle | null = null;
		try {
			timer = deps.timeout(step.limitMs);
			const outcome = await Promise.race([step.run().then(() => "done" as const), timer.done]);
			if (outcome === "timeout") {
				const reason = `took longer than ${step.limitMs} ms`;
				deps.logger.warn(`Shutdown step ${step.name} ${reason}`);
				report.failed.push({ name: step.name, reason });
			} else {
				report.completed.push(step.name);
			}
		} catch (cause) {
			const reason = messageOf(cause);
			deps.logger.error(`Shutdown step ${step.name} failed`, { reason });
			report.failed.push({ name: step.name, reason });
		} finally {
			timer?.cancel();
		}
	}
	return report;
}
