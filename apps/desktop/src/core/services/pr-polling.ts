/**
 * @feature PR-03 PR polling schedule and the rate-limit gate
 * Owns: the decisions that keep polling GitHub cheap: how often each workspace polls, whether to
 * poll at all given the remaining GraphQL budget, how many pull requests go in one query, and
 * which workspaces are skipped.
 * Behaviour: services-map.md 3.0.2 (a branch with no PR is remembered for 5 minutes), 3.7.2
 * (batch size adaptivity), 3.7.3 and 5B.1.2 (cadence, subscriptions, skip rules), 5B.1.3 (the
 * gate: budget probe, thresholds, cache).
 * Must handle: an unknown budget (poll at the requested rate); budget below 500 (poll nothing);
 * below 1000 (poll only the selected workspace, at most once a minute, and do not batch
 * siblings); a PR whose mergeability GitHub is still computing polls every second; the schedule
 * never goes below one second; a failed or slow batch shrinks the next batch, a good one grows it
 * back by a fifth (at least one); no subscribers (nothing to poll); the poller skips unlinked,
 * offline and remote-less workspaces, and the owner of the subscription stops inactive ones; a
 * branch that was never pushed asks GitHub nothing; a failed budget probe is an error value,
 * never a made-up budget.
 * Our design choice: the numbers are the researched ones. The pure functions decide; the poller in
 * services/github.ts only applies them and owns the timers.
 * Test first: with 800 calls left, a sidebar workspace is paused and the selected one polls at
 * most once a minute.
 */
import { err, ok, type Result } from "@conducted/shared";

export const VISIBLE_POLL_MS = 5_000;
export const SIDEBAR_POLL_MS = 300_000;
export const MIN_POLL_MS = 1_000;
export const BUDGET_STOP_BELOW = 500;
export const BUDGET_MAIN_ONLY_BELOW = 1_000;
export const MAIN_ONLY_MIN_POLL_MS = 60_000;
export const MAX_BATCH_SIZE = 5;
/** How long a "this branch has no PR" answer is reused (services-map 3.0.2). */
export const NO_PR_MEMORY_MS = 300_000;

export type PollRole = "selected" | "sidebar";

export interface PollDecision {
	poll: boolean;
	intervalMs: number;
	/** When true, fetch only the requested workspace instead of batching its siblings. */
	requestedOnly: boolean;
}

/** `remaining` is the GraphQL budget left, or null when the host does not rate limit. */
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

export interface PollSubscription {
	role: PollRole;
	intervalMs: number;
}

/**
 * The poll interval for a workspace with these subscribers (services-map 5B.1.2): the smallest
 * requested interval wins, the schedule never goes below one second, and the rate-limit gate has
 * the final say. With no subscribers there is nothing to poll.
 */
export function updatePolling(
	subscriptions: readonly PollSubscription[],
	remaining: number | null,
): PollDecision {
	let chosen: PollSubscription | null = null;
	for (const subscription of subscriptions) {
		if (
			chosen === null ||
			subscription.intervalMs < chosen.intervalMs ||
			(subscription.intervalMs === chosen.intervalMs &&
				subscription.role === "selected" &&
				chosen.role === "sidebar")
		) {
			chosen = subscription;
		}
	}
	if (chosen === null) return { poll: false, intervalMs: SIDEBAR_POLL_MS, requestedOnly: true };
	return decidePolling(remaining, chosen.role, chosen.intervalMs);
}

export type PollSkipReason = "inactive" | "unlinked" | "no_remote" | "offline";

export interface WorkspacePollState {
	active: boolean;
	repoLinked: boolean;
	hasRemote: boolean;
	offline: boolean;
}

/**
 * Why a workspace's PR poll is skipped (services-map 3.7.3, 5B.1.2). Null means it may poll.
 * The budget rule is separate, in `decidePolling`.
 */
export function pollSkipReason(state: WorkspacePollState): PollSkipReason | null {
	if (!state.active) return "inactive";
	if (!state.repoLinked) return "unlinked";
	if (state.offline) return "offline";
	if (!state.hasRemote) return "no_remote";
	return null;
}

/**
 * Whether to ask GitHub about a branch (services-map 3.7.2): a bound PR number always asks; a
 * branch that was never pushed has no PR to find.
 */
export function shouldQueryPr(branchPushed: boolean, prNumber: number | null): boolean {
	return prNumber !== null || branchPushed;
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

export interface RateLimitGateDeps {
	/** Reads the GraphQL budget left. Ok(null) means the host does not rate limit. */
	readRemaining: () => Promise<Result<number | null>>;
	now: () => number;
}

export interface RateLimitGate {
	/** Chooses the smallest subscription and asks the gate whether it may run. */
	decide(subscriptions: readonly PollSubscription[]): Promise<Result<PollDecision>>;
}

/**
 * The GraphQL rate-limit gate (services-map 5B.1.3). The budget answer is cached for 60 s when it
 * is high and 500 ms when it is low; two calls at once share one probe. A probe that fails is
 * returned as an error value, never turned into a made-up budget.
 */
export function createRateLimitGate(deps: RateLimitGateDeps): RateLimitGate {
	let cached: { remaining: number | null; at: number } | null = null;
	let probe: Promise<Result<number | null>> | null = null;

	const read = (): Promise<Result<number | null>> => {
		if (cached !== null) {
			const ttl = budgetCacheMs(cached.remaining ?? BUDGET_MAIN_ONLY_BELOW);
			if (deps.now() - cached.at < ttl) return Promise.resolve(ok(cached.remaining));
		}
		if (probe !== null) return probe;
		probe = deps.readRemaining().then((result) => {
			probe = null;
			if (result.ok) cached = { remaining: result.value, at: deps.now() };
			return result;
		});
		return probe;
	};

	return {
		async decide(subscriptions) {
			const remaining = await read();
			if (!remaining.ok) return err(remaining.error);
			return ok(updatePolling(subscriptions, remaining.value));
		},
	};
}
