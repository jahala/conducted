/**
 * @feature APP-11 Exponential backoff
 * Owns: the pure step that spaces retries of polls and reconnects: each failure waits longer, up to a cap,
 * and a quiet period or a success starts over.
 * Behaviour: services-map.md 1.5 (an exponential backoff counter, `Y3`), 3.7.3 (poll cadence and the
 * rate-limit gate for pull request polls).
 * Our design choice: the state is a plain value and the step is a pure function. Time and randomness are
 * passed in (a `Clock` from @conducted/shared and a `random` function), so tests need no timers.
 * Must handle: the first failure (the base delay); many failures in a row (the delay stops at the cap and
 * the attempt count keeps counting for logs); jitter between 0 and the given fraction, never negative and
 * never past the cap; a success (back to attempt 0); a long quiet time since the last failure (the next
 * failure counts as a first one); a base delay of zero or a cap below the base (refused as a programmer
 * error at construction, not at run time).
 * Test first: with base 1,000 ms, factor 2, cap 8,000 ms and no jitter, five failures in a row give 1,000,
 * 2,000, 4,000, 8,000 and 8,000 ms.
 */
import type { Clock } from "@conducted/shared";

export interface BackoffPolicy {
	baseMs: number;
	factor: number;
	capMs: number;
	/** Share of the delay that may be added at random, from 0 to 1. */
	jitter: number;
	/** After this long without a failure the next failure counts as the first. */
	resetAfterMs: number;
}

export interface BackoffState {
	attempt: number;
	lastFailureAt: number | null;
}

export const INITIAL_BACKOFF: BackoffState = { attempt: 0, lastFailureAt: null };

/**
 * A policy with an impossible value is a programmer error. It is refused when a counter is built,
 * before any delay is produced.
 */
export function checkBackoffPolicy(policy: BackoffPolicy): void {
	if (!Number.isFinite(policy.baseMs) || policy.baseMs <= 0) {
		throw new RangeError("backoff baseMs must be a finite number greater than 0");
	}
	if (!Number.isFinite(policy.capMs) || policy.capMs < policy.baseMs) {
		throw new RangeError("backoff capMs must be finite and at least baseMs");
	}
	if (!Number.isFinite(policy.factor) || policy.factor < 1) {
		throw new RangeError("backoff factor must be finite and at least 1");
	}
	if (Number.isNaN(policy.jitter) || policy.jitter < 0 || policy.jitter > 1) {
		throw new RangeError("backoff jitter must be between 0 and 1");
	}
	if (Number.isNaN(policy.resetAfterMs) || policy.resetAfterMs < 0) {
		throw new RangeError("backoff resetAfterMs must be 0 or more");
	}
}

/** Records a failure and says how long to wait before the next try. */
export function nextBackoff(
	state: BackoffState,
	policy: BackoffPolicy,
	clock: Clock,
	random: () => number,
): { state: BackoffState; delayMs: number } {
	checkBackoffPolicy(policy);
	const now = clock.now();
	const quiet = state.lastFailureAt !== null && now - state.lastFailureAt >= policy.resetAfterMs;
	const attempt = (quiet ? 0 : state.attempt) + 1;
	const capped = Math.min(policy.capMs, policy.baseMs * policy.factor ** (attempt - 1));
	const sample = Math.min(1, Math.max(0, random()));
	const delayMs = Math.min(policy.capMs, capped * (1 + policy.jitter * sample));
	return { state: { attempt, lastFailureAt: now }, delayMs };
}

export interface BackoffCounter {
	/** The state after the failures recorded so far. */
	state(): BackoffState;
	/** Records a failure and returns the delay before the next try. */
	fail(): number;
	/** A success starts the counter over. */
	succeed(): void;
}

/**
 * A stateful wrapper over `nextBackoff` for a poll or reconnect loop. The policy is checked once,
 * here, so a bad value fails at construction rather than in the middle of a retry.
 */
export function createBackoff(
	policy: BackoffPolicy,
	clock: Clock,
	random: () => number,
): BackoffCounter {
	checkBackoffPolicy(policy);
	let state = INITIAL_BACKOFF;
	return {
		state: () => state,
		fail: () => {
			const next = nextBackoff(state, policy, clock, random);
			state = next.state;
			return next.delayMs;
		},
		succeed: () => {
			state = INITIAL_BACKOFF;
		},
	};
}
