/**
 * @feature PR-07 PR checks summary
 * Owns: the Checks block of the PR tab: a one-line summary of the checks and a link to the Checks
 * tab of the git panel for details.
 * Behaviour: ui-map.md 3.2 (PR tab: Checks); the full list lives in the git panel (PR-04).
 * Our design choice: the PR tab shows counts and failing check names only, to keep one home for the
 * detailed list.
 * Must handle: no checks, all passing, failing (names of up to three, then "and N more"), pending,
 * and the checks being unavailable.
 * Test first: two failed and one passing check render "2 failed" and both names.
 */
import { notImplemented } from "@conducted/shared";
import type { CheckRun } from "../../core/model.ts";

export interface PrChecksSummaryProps {
	checks: CheckRun[];
	onShowDetails: () => void;
}

export function PrChecksSummary(_props: PrChecksSummaryProps): never {
	return notImplemented("PR-07");
}
