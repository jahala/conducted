/**
 * @feature APP-04 Changes tab empty states
 * Owns: the designed message for each reason the Changes list is empty or incomplete.
 * Behaviour: ui-map.md 3.6, Changes paragraph (empty texts) and 7.2.
 * Reasons: "no_changes" (changes will appear here), "no_git_status" (the repository could not be
 * read), "operation_in_progress" (finish the rebase or merge to see changes), "filter_no_match"
 * (no file matches the filter, with a clear-filter action), "untracked_truncated" (a note under a
 * non-empty list: some untracked files are not shown).
 * Must handle: each reason has its own text and at most one action, and the note variant sits
 * below the list without hiding it.
 * Test first: reason "filter_no_match" shows a clear-filter button that calls onClearFilter.
 */
import { notImplemented } from "@conducted/shared";

export type ChangesEmptyReason =
	| "no_changes"
	| "no_git_status"
	| "operation_in_progress"
	| "filter_no_match"
	| "untracked_truncated";

export interface ChangesEmptyProps {
	reason: ChangesEmptyReason;
	/** The git operation underway, for the "operation_in_progress" text. */
	operation?: "rebase" | "merge" | "cherry_pick" | "revert";
	onClearFilter?: () => void;
}

export function ChangesEmpty(_props: ChangesEmptyProps): never {
	return notImplemented("APP-04");
}
