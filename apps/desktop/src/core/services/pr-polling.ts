/**
 * @feature PR-03 PR polling schedule and the rate-limit gate
 * Owns: the decisions that keep polling GitHub cheap: how often each workspace polls, whether to
 * poll at all given the remaining GraphQL budget, and how many pull requests go in one query.
 * Behaviour: services-map.md 3.7.2 (batch size adaptivity), 3.7.3 and 5B.1.2 (cadence), 5B.1.3
 * (the gate: budget probe, thresholds, cache).
 * Must handle: an unknown budget (poll at the requested rate); budget below 500 (poll nothing);
 * below 1000 (poll only the selected workspace, at most once a minute, and do not batch
 * siblings); a PR whose mergeability GitHub is still computing polls every second; the schedule
 * never goes below one second; a failed or slow batch shrinks the next batch, a good one grows it
 * back by a fifth (at least one).
 * Our design choice: the numbers are the researched ones. Pure functions, so the poller in
 * services/github.ts only has to apply them.
 * Test first: with 800 calls left, a sidebar workspace is paused and the selected one polls at
 * most once a minute.
 */

export const VISIBLE_POLL_MS = 5_000;
export const SIDEBAR_POLL_MS = 300_000;
export const MIN_POLL_MS = 1_000;
export const BUDGET_STOP_BELOW = 500;
export const BUDGET_MAIN_ONLY_BELOW = 1_000;
export const MAIN_ONLY_MIN_POLL_MS = 60_000;
export const MAX_BATCH_SIZE = 5;

export type PollRole = "selected" | "sidebar";

export interface PollDecision {
	poll: boolean;
	intervalMs: number;
	/** When true, fetch only the requested workspace instead of batching its siblings. */
	requestedOnly: boolean;
}

/** `remaining` is the GraphQL budget left, or null when it could not be read. */
export function decidePolling(
	remaining: number | null,
	role: PollRole,
	requestedIntervalMs: number,
): PollDecision {
	const interval = Math.max(requestedIntervalMs, MIN_POLL_MS);
	if (remaining === null) return { poll: true, intervalMs: interval, requestedOnly: false };
	if (remaining < BUDGET_STOP_BELOW)
		return { poll: false, intervalMs: interval, requestedOnly: true };
	if (remaining < BUDGET_MAIN_ONLY_BELOW) {
		return role === "selected"
			? { poll: true, intervalMs: Math.max(interval, MAIN_ONLY_MIN_POLL_MS), requestedOnly: true }
			: { poll: false, intervalMs: interval, requestedOnly: true };
	}
	return { poll: true, intervalMs: interval, requestedOnly: false };
}

/** How often to poll one workspace, before the gate applies. */
export function requestedInterval(
	role: PollRole,
	pr: { mergeStateStatus: string | null; merged: boolean } | null,
): number {
	if (pr !== null && pr.mergeStateStatus === "UNKNOWN" && !pr.merged) return MIN_POLL_MS;
	return role === "selected" ? VISIBLE_POLL_MS : SIDEBAR_POLL_MS;
}

/** How long the budget answer may be reused. */
export const budgetCacheMs = (remaining: number): number => (remaining >= 1_000 ? 60_000 : 500);

export interface BatchSizes {
	/** Size after timeouts. */
	byTimeout: number;
	/** Size after a high query cost. */
	byCost: number;
}

export const initialBatchSizes = (): BatchSizes => ({
	byTimeout: MAX_BATCH_SIZE,
	byCost: MAX_BATCH_SIZE,
});

export const effectiveBatchSize = (sizes: BatchSizes): number =>
	Math.max(1, Math.min(sizes.byTimeout, sizes.byCost));

export type BatchOutcome = { kind: "timeout" } | { kind: "success"; cost: number };

export function nextBatchSizes(sizes: BatchSizes, outcome: BatchOutcome): BatchSizes {
	if (outcome.kind === "timeout") {
		return { ...sizes, byTimeout: Math.max(1, Math.floor(sizes.byTimeout / 2)) };
	}
	const grow = (n: number) => Math.min(MAX_BATCH_SIZE, n + Math.max(1, Math.ceil(0.2 * n)));
	return {
		byTimeout: grow(sizes.byTimeout),
		byCost: outcome.cost > 1 ? Math.max(1, Math.floor(sizes.byCost / 2)) : grow(sizes.byCost),
	};
}
