/**
 * @feature PR-04 Reviewers list
 * Owns: the reviewers block of the Checks tab. Each reviewer with a state, and the review summary.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (states Approved, Changes requested, Commented,
 * Dismissed, Awaiting review; "Review required").
 * Must handle: no reviewers requested, a long list (the first ten, then a "show all" control), and
 * the review decision the PR reports.
 * Test first: reviewers [approved, awaiting] render both states and the summary says review
 * required when reviewDecision is review_required.
 */
import { useState } from "react";
import type { PullRequest, ReviewerState, ReviewerView } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";

export interface ReviewersListProps {
	reviewers: ReviewerView[];
	reviewDecision: PullRequest["reviewDecision"];
	canRequestReview: boolean;
	onRequestReview: (login: string) => void;
}

const STATE_LABEL: Readonly<Record<ReviewerState, string>> = {
	approved: "Approved",
	changes_requested: "Changes requested",
	commented: "Commented",
	dismissed: "Dismissed",
	awaiting: "Awaiting review",
};

const DECISION_LABEL: Readonly<Record<NonNullable<PullRequest["reviewDecision"]>, string>> = {
	approved: "Approved",
	changes_requested: "Changes requested",
	review_required: "Review required",
};

export function reviewerStateLabel(state: ReviewerState): string {
	return STATE_LABEL[state];
}

export function ReviewersList({ reviewers, reviewDecision, canRequestReview }: ReviewersListProps) {
	const [showAll, setShowAll] = useState(false);
	const visible = showAll ? reviewers : reviewers.slice(0, 10);
	const decision = reviewDecision === null ? null : DECISION_LABEL[reviewDecision];

	return (
		<section aria-label="Reviewers" className="px-2 py-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-medium text-fg">Reviewers</h3>
				{decision === null ? null : <span className="text-xs text-fg-muted">{decision}</span>}
			</div>
			{reviewers.length === 0 ? (
				<p className="mt-1 text-xs text-fg-muted">
					{canRequestReview
						? "No reviewers requested. Ask for a review on GitHub."
						: "No reviewers requested."}
				</p>
			) : (
				<ul className="mt-1 space-y-1">
					{visible.map((reviewer) => (
						<li key={reviewer.login} className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate text-sm text-fg">{reviewer.login}</span>
							<span className="text-xs text-fg-muted">{STATE_LABEL[reviewer.state]}</span>
						</li>
					))}
				</ul>
			)}
			{reviewers.length > 10 && !showAll ? (
				<Button variant="link" size="xs" onClick={() => setShowAll(true)}>
					Show all {reviewers.length}
				</Button>
			) : null}
		</section>
	);
}
