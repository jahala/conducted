/**
 * @feature SIDE-07 Process manager: idle stop and warm pool
 * Owns: the two pure rules that decide which agent processes to stop: the idle timeout and the
 * cap on unused warm processes.
 * Behaviour: research/conductor/sessions.md section 3 "Process manager N4t": idle timeout 30
 * minutes, sweep every 2 s, a process with background tasks is skipped, and at most 2 warm
 * processes (retention "warm", no leases) are kept; the least recently idle go first.
 * Must handle: a leased process is never stopped, a busy one (working) is never stopped, a process
 * with background tasks survives the idle sweep, a process that was never idle (lastIdleAt null)
 * is not stopped by the idle rule, and ties in the warm cap break by oldest first.
 * Test first: three warm unleased entries with idle times 1, 2, 3 and cap 2 evict the one idle at 1.
 * Our design choice: the numbers are Conductor's, stated as ours: 30 minutes, 2 s, 2 warm.
 */
export const IDLE_STOP_AFTER_MS = 30 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 2_000;
export const MAX_WARM_PROCESSES = 2;

export type Retention = "warm" | "active";

export interface ProcessEntryView {
	key: string;
	retention: Retention;
	activeLeases: number;
	/** True while the chat is working. */
	busy: boolean;
	hasBackgroundTasks: boolean;
	/** When the process last went idle (ms since epoch), or null if it never did. */
	lastIdleAt: number | null;
}

/** Keys of processes idle for longer than the timeout. */
export function selectIdleToStop(
	entries: readonly ProcessEntryView[],
	now: number,
	idleStopAfterMs: number = IDLE_STOP_AFTER_MS,
): string[] {
	return entries
		.filter(
			(entry) =>
				entry.activeLeases === 0 &&
				!entry.busy &&
				!entry.hasBackgroundTasks &&
				entry.lastIdleAt !== null &&
				now - entry.lastIdleAt >= idleStopAfterMs,
		)
		.map((entry) => entry.key);
}

/** Keys of warm, unleased processes beyond the cap, least recently idle first. */
export function selectWarmToEvict(
	entries: readonly ProcessEntryView[],
	maxWarm: number = MAX_WARM_PROCESSES,
): string[] {
	const warm = entries
		.filter((entry) => entry.retention === "warm" && entry.activeLeases === 0)
		.sort((a, b) => (a.lastIdleAt ?? 0) - (b.lastIdleAt ?? 0));
	return warm.slice(0, Math.max(0, warm.length - maxWarm)).map((entry) => entry.key);
}
