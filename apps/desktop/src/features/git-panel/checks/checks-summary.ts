/**
 * @feature PR-04 Checks summary
 * Owns: pure functions that sort checks for display and summarise them into counts and one
 * overall state. Used by the Checks tab's counts and the Git panel's failing mark on the Checks
 * tab. Which checks block a merge is core/status/git-header.ts's rule (`countsAsBlocking`).
 * Behaviour: services-map.md 3.7.2 ("Derived state": pending is IN_PROGRESS, EXPECTED, QUEUED or
 * PENDING; failing is FAILURE, ERROR, TIMED_OUT, ACTION_REQUIRED or STARTUP_FAILURE). The services
 * map CheckRun states onto CheckState; this file only reads CheckState.
 * Must handle: no checks, all skipped, a mix of cancelled and success, optional checks when
 * treatOptionalAsBlocking is off (they are left out of the overall state; they have
 * `required: false` on CheckRun). Duplicates are removed before this file sees them.
 * Test first: [failure, pending, success] gives failed 1, pending 1, total 3, overall "failing".
 */
import type { CheckRun, CheckState } from "../../../core/model.ts";
import { countsAsBlocking } from "../../../core/status/git-header.ts";

export interface ChecksSummary {
	total: number;
	failed: number;
	pending: number;
	passed: number;
	overall: "none" | "passing" | "pending" | "failing";
}

const PENDING_STATES: ReadonlySet<CheckState> = new Set(["pending", "waiting", "running"]);
const FAILED_STATES: ReadonlySet<CheckState> = new Set(["failure"]);

/**
 * Counts every check, and decides the overall state from the checks that block a merge. With
 * `treatOptionalAsBlocking` off, a check that is not required is counted but cannot make the
 * overall state fail or wait.
 */
export function summarizeChecks(
	checks: readonly CheckRun[],
	options: { treatOptionalAsBlocking: boolean },
): ChecksSummary {
	const failed = checks.filter((check) => FAILED_STATES.has(check.state)).length;
	const pending = checks.filter((check) => PENDING_STATES.has(check.state)).length;
	const passed = checks.filter((check) => check.state === "success").length;
	const blocking = checks.filter((check) =>
		countsAsBlocking(check, options.treatOptionalAsBlocking),
	);

	const overall: ChecksSummary["overall"] =
		checks.length === 0
			? "none"
			: blocking.some((check) => FAILED_STATES.has(check.state))
				? "failing"
				: blocking.some((check) => PENDING_STATES.has(check.state))
					? "pending"
					: "passing";

	return { total: checks.length, failed, pending, passed, overall };
}

const DISPLAY_RANK: Readonly<Record<CheckState, number>> = {
	failure: 0,
	running: 1,
	pending: 2,
	waiting: 2,
	cancelled: 3,
	skipped: 4,
	success: 5,
};

/** Failed first, then running and pending, then cancelled, skipped, success. Ties by name. */
export function sortChecksForDisplay(checks: readonly CheckRun[]): CheckRun[] {
	return [...checks].sort((left, right) => {
		const byState = DISPLAY_RANK[left.state] - DISPLAY_RANK[right.state];
		if (byState !== 0) return byState;
		return left.name.localeCompare(right.name);
	});
}
