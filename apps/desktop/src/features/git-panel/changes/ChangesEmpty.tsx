/**
 * @feature APP-04 Changes tab empty states
 * Owns: the designed message for each reason the Changes list is empty or incomplete.
 * Behaviour: ui-map.md 3.6, Changes paragraph (empty texts) and 7.2.
 * Reasons: "no_changes" (changes will appear here), "no_git_status" (the repository could not be
 * read), "operation_in_progress" (finish the rebase or merge to see changes), "filter_no_match"
 * (no file matches the filter, with a clear-filter action), "untracked_truncated" (a note under a
 * non-empty list: some untracked files are not shown), "no_range_changes" (the chosen stack pull
 * requests change nothing; Conductor's words, PR-08).
 * Must handle: each reason has its own text and at most one action, "no_git_status" showing the
 * error's own message when the caller has one, and the note variant sitting below the list without
 * hiding it.
 * Test first: reason "filter_no_match" shows a clear-filter button that calls onClearFilter.
 */
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";

export type ChangesEmptyReason =
	| "no_changes"
	| "no_git_status"
	| "operation_in_progress"
	| "filter_no_match"
	| "untracked_truncated"
	| "no_range_changes";

export interface ChangesEmptyProps {
	reason: ChangesEmptyReason;
	/** The git operation underway, for the "operation_in_progress" text. */
	operation?: "rebase" | "merge" | "cherry_pick" | "revert";
	onClearFilter?: () => void;
	/** The error's own words, for "no_git_status". Without it the generic text shows. */
	message?: string;
}

const operationLabel: Record<NonNullable<ChangesEmptyProps["operation"]>, string> = {
	rebase: "rebase",
	merge: "merge",
	cherry_pick: "cherry-pick",
	revert: "revert",
};

export function ChangesEmpty({ reason, operation, onClearFilter, message }: ChangesEmptyProps) {
	if (reason === "no_range_changes") {
		return <EmptyState compact title="No changes in the selected PRs" />;
	}
	if (reason === "untracked_truncated") {
		return (
			<p role="note" className="px-3 py-2 text-xs text-fg-muted">
				Some untracked files are not shown.
			</p>
		);
	}
	if (reason === "filter_no_match") {
		return (
			<EmptyState
				compact
				title="No files match this filter"
				body="Clear the filter to see every changed file."
				action={
					<Button variant="secondary" size="sm" onClick={onClearFilter}>
						Clear filter
					</Button>
				}
			/>
		);
	}
	if (reason === "no_git_status") {
		return (
			<EmptyState
				compact
				tone="failed"
				title="No git status"
				body={message ?? "The repository could not be read."}
			/>
		);
	}
	if (reason === "operation_in_progress") {
		const label = operation ? operationLabel[operation] : "git operation";
		return (
			<EmptyState
				compact
				title={`Finish the ${label}`}
				body={`Changes appear here once the ${label} finishes.`}
			/>
		);
	}
	return (
		<EmptyState
			compact
			title="Changes appear here"
			body="As you and the agent edit files, their changes appear here."
		/>
	);
}
