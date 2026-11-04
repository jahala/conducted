/**
 * @feature PR-04 Checks summary
 * Owns: pure functions that sort checks for display and summarise them into counts and one
 * overall state. Used by the Checks tab, the PR tab and the git header.
 * Behaviour: services-map.md 3.7.2 ("Derived state": pending is IN_PROGRESS, EXPECTED, QUEUED or
 * PENDING; failing is FAILURE, ERROR, TIMED_OUT, ACTION_REQUIRED or STARTUP_FAILURE; duplicate
 * runs of one workflow and name keep only the newest). The services map CheckRun states onto
 * CheckState; this file only reads CheckState.
 * Must handle: no checks, all skipped, a mix of cancelled and success, optional checks when
 * treatOptionalAsBlocking is off (ignored in the overall state; they have `required: false` on
 * CheckRun), and duplicates (the caller already removed them; this file
 * never double counts).
 * Test first: [failure, pending, success] gives failed 1, pending 1, total 3, overall "failing".
 */
import { notImplemented } from "@conducted/shared";
import type { CheckRun } from "../../../core/model.ts";

export interface ChecksSummary {
	total: number;
	failed: number;
	pending: number;
	passed: number;
	overall: "none" | "passing" | "pending" | "failing";
}

export function summarizeChecks(
	_checks: readonly CheckRun[],
	_options: { treatOptionalAsBlocking: boolean },
): ChecksSummary {
	return notImplemented("PR-04");
}

/** Failed first, then running and pending, then cancelled, skipped, success. Ties by name. */
export function sortChecksForDisplay(_checks: readonly CheckRun[]): CheckRun[] {
	return notImplemented("PR-04");
}
