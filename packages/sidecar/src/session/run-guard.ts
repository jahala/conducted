/**
 * @feature SIDE-04 Turn lifecycle and stale-run guard
 * Owns: the run number of a chat. Every async step of a turn remembers the number it started with
 * and checks it before it changes state, so a late result from a cancelled or replaced run is
 * dropped.
 * Behaviour: research/conductor/sessions.md section 2 "Stale-result guard" (every continuation
 * compares currentTurnRunId with its own runId; a cancel or a newer turn bumps activeRunId).
 * Must handle: a cancel bumps the number without starting a turn, a new turn bumps it again, and
 * a continuation holding an older number is refused even if its turn id matches.
 * Test first: start() returns 1; cancel() makes isCurrent(1) false; the next start() returns 3.
 */
export type RunNumber = number & { readonly __run: unique symbol };

export class RunGuard {
	private current = 0;

	/** Starts a new run and returns its number. Older runs stop being current. */
	start(): RunNumber {
		this.current += 1;
		return this.current as RunNumber;
	}

	/** Invalidates the current run without starting another (cancel, reset). */
	invalidate(): void {
		this.current += 1;
	}

	isCurrent(run: RunNumber): boolean {
		return run === this.current;
	}
}
