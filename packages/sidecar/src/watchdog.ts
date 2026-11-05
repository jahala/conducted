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
import type { Logger } from "./logging/logger.ts";
import { SWEEP_INTERVAL_MS } from "./process/idle-policy.ts";
import type { ProcessManager } from "./process/process-manager.ts";
import { messageOf } from "./util/errors.ts";

export interface IntervalScheduler {
	/** Calls `fn` every `ms`. Returns the function that stops it. */
	every(ms: number, fn: () => void): () => void;
}

/** The log tag Conductor uses for this module. */
export const WATCHDOG_LOG_TAG = "WATCHDOG";

export class ParentWatchdog {
	private readonly logger: Logger;
	private stopTimer: (() => void) | null = null;
	private ticking = false;
	private parentGone = false;

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
	) {
		this.logger = deps.logger.child(WATCHDOG_LOG_TAG);
	}

	start(): void {
		if (this.stopTimer !== null) return;
		this.stopTimer = this.deps.scheduler.every(SWEEP_INTERVAL_MS, () => {
			void this.tick();
		});
	}

	stop(): void {
		this.stopTimer?.();
		this.stopTimer = null;
	}

	/**
	 * Runs one watchdog tick: the parent check first, then the idle sweep. A tick that starts while
	 * another is still running does nothing, so two sweeps never overlap.
	 */
	async tick(): Promise<void> {
		if (this.ticking || this.parentGone) return;
		this.ticking = true;
		try {
			const parentPid = this.deps.currentParentPid();
			if (parentPid !== this.deps.initialParentPid) {
				this.parentGone = true;
				this.logger.warn("The parent process is gone; the sidecar is shutting down", {
					initialParentPid: this.deps.initialParentPid,
					currentParentPid: parentPid,
				});
				this.deps.onParentGone();
				return;
			}
			try {
				await this.deps.processes.sweep();
			} catch (cause) {
				this.logger.warn("The idle sweep failed", { reason: messageOf(cause) });
			}
		} catch (cause) {
			this.logger.warn("The parent check failed", { reason: messageOf(cause) });
		} finally {
			this.ticking = false;
		}
	}
}
