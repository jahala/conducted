/**
 * @feature APP-04 Changes tab empty states
 * Owns: the designed message for each reason the Changes list is empty or incomplete.
 * Behaviour: ui-map.md 3.6, Changes paragraph (empty texts) and 7.2.
 * Reasons: "no_changes" (changes will appear here), "no_git_status" (the repository could not be
 * read), "operation_in_progress" (Conductor's "No git status" with "Finish rebasing or merging to
 * see changes"), "filter_no_match"
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
import { GitCompareIcon } from "../../../ui/icons.tsx";

export type ChangesEmptyReason =
	| "no_changes"
	| "no_git_status"
	| "operation_in_progress"
	| "filter_no_match"
	| "untracked_truncated"
	| "no_range_changes";

export interface ChangesEmptyProps {
	reason: ChangesEmptyReason;
	onClearFilter?: () => void;
	/** The error's own words, for "no_git_status". Without it the generic text shows. */
	message?: string;
}

export function ChangesEmpty({ reason, onClearFilter, message }: ChangesEmptyProps) {
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
		return (
			<EmptyState compact title="No git status" body="Finish rebasing or merging to see changes" />
		);
	}
	return (
		<EmptyState
			compact
			icon={<GitCompareIcon className="size-10 text-fg-muted" />}
			title="No file changes yet"
			body="Changes appear here."
		/>
	);
}
