/**
 * @feature SIDE-19 Parent watchdog and graceful shutdown: the watchdog
 * Owns: the 2-second tick that checks whether the Rust shell is still the parent process, sweeps
 * idle agents and retries nothing else.
 * Behaviour: research/conductor/sessions.md sections 3 and 8: the sidecar polls its parent pid
 * every 2 s and shuts down when it changed, so a dead app does not leave agents running; the same
 * tick runs the idle sweep (30 minutes) and the warm cap. native-and-sidecar-map.md A6 step 9:
 * Rust also hunts orphaned sidecars.
 * Must handle:
 *  - the parent pid changed (the app died and the sidecar was adopted): start shutdown once
 *  - a sweep that throws: logged, the next tick still runs
 *  - a tick that arrives while the previous one still runs: skipped (no overlapping sweeps)
 *  - stop(): clears the timer; no tick runs afterwards
 *  - timers come from an injected scheduler, so tests never wait
 * Test first: with a fake scheduler and a parent pid that changes from 100 to 1, the next tick calls
 * onParentGone once and a second tick does not call it again.
 */
import { notImplemented } from "@conducted/shared";
import type { Logger } from "./logging/logger.ts";
import type { ProcessManager } from "./process/process-manager.ts";

export interface IntervalScheduler {
	/** Calls `fn` every `ms`. Returns the function that stops it. */
	every(ms: number, fn: () => void): () => void;
}

export class ParentWatchdog {
	constructor(
		protected readonly deps: {
			scheduler: IntervalScheduler;
			/** The parent pid at start, from process.ppid. */
			initialParentPid: number;
			/** The parent pid now. */
			currentParentPid(): number;
			processes: ProcessManager;
			onParentGone(): void;
			logger: Logger;
		},
	) {}

	start(): void {
		notImplemented("SIDE-19");
	}

	stop(): void {
		notImplemented("SIDE-19");
	}
}
