/**
 * @feature SIDE-19 Parent watchdog and graceful shutdown: the watchdog
 * Owns: two independent 2-second timers: one checks whether the Rust shell is still the parent
 * process, the other sweeps idle agents and applies the warm cap.
 * Behaviour: research/conductor/sessions.md sections 3 and 8: the sidecar polls its parent pid
 * every 2 s and shuts down when it changed, so a dead app does not leave agents running; the idle
 * sweep (30 minutes) and the warm cap run on their own 2-second timer. native-and-sidecar-map.md
 * A6 step 9: Rust also hunts orphaned sidecars.
 * Must handle:
 *  - the parent pid changed (the app died and the sidecar was adopted): start shutdown once
 *  - a sweep that throws: logged, the next sweep still runs
 *  - a slow or hung sweep: it never blocks the parent check, because the two run on separate
 *    timers; a sweep that starts while another still runs is skipped
 *  - stop(): clears both timers; no check or sweep runs afterwards
 *  - timers come from an injected scheduler, so tests never wait
 * Test first: with a fake scheduler and a parent pid that changes from 100 to 1, the next check
 * calls onParentGone once and a second check does not call it again.
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
	private stopCheckTimer: (() => void) | null = null;
	private stopSweepTimer: (() => void) | null = null;
	private sweeping = false;
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
		if (this.stopCheckTimer !== null) return;
		this.stopCheckTimer = this.deps.scheduler.every(SWEEP_INTERVAL_MS, () => {
			this.checkParent();
		});
		this.stopSweepTimer = this.deps.scheduler.every(SWEEP_INTERVAL_MS, () => {
			void this.sweep();
		});
	}

	stop(): void {
		this.stopCheckTimer?.();
		this.stopSweepTimer?.();
		this.stopCheckTimer = null;
		this.stopSweepTimer = null;
	}

	/**
	 * Checks the parent once. It has its own timer, so a slow or hung sweep can never delay it.
	 */
	checkParent(): void {
		if (this.parentGone) return;
		try {
			const parentPid = this.deps.currentParentPid();
			if (parentPid === this.deps.initialParentPid) return;
			this.parentGone = true;
			this.stop();
			this.logger.warn("The parent process is gone; the sidecar is shutting down", {
				initialParentPid: this.deps.initialParentPid,
				currentParentPid: parentPid,
			});
			this.deps.onParentGone();
		} catch (cause) {
			this.logger.warn("The parent check failed", { reason: messageOf(cause) });
		}
	}

	/**
	 * Runs one idle sweep. A sweep that starts while another still runs does nothing, so two
	 * sweeps never overlap. It is skipped once the parent is gone.
	 */
	async sweep(): Promise<void> {
		if (this.sweeping || this.parentGone) return;
		this.sweeping = true;
		try {
			await this.deps.processes.sweep();
		} catch (cause) {
			this.logger.warn("The idle sweep failed", { reason: messageOf(cause) });
		} finally {
			this.sweeping = false;
		}
	}
}
