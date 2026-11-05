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
import { type Clock, notImplemented } from "@conducted/shared";

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

/** Records a failure and says how long to wait before the next try. */
export function nextBackoff(
	_state: BackoffState,
	_policy: BackoffPolicy,
	_clock: Clock,
	_random: () => number,
): { state: BackoffState; delayMs: number } {
	return notImplemented("APP-11");
}
