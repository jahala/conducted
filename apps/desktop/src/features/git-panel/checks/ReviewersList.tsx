/**
 * @feature PR-04 Reviewers list
 * Owns: the reviewers block of the Checks tab. Each reviewer with a state, and the review summary.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (states Approved, Changes requested, Commented,
 * Dismissed, Awaiting review; "Request review"; "Review required"); services-map.md 3.7.5
 * (reviewers are edited with `gh pr edit --add-reviewer`).
 * Must handle: no reviewers requested, a team reviewer (shown by slug), the viewer being the PR
 * author (cannot approve), the request-review action failing (toast), and a long list (first ten,
 * then "show all").
 * Test first: reviewers [approved, awaiting] render both states and the summary says review
 * required when reviewDecision is review_required.
 */
import { notImplemented } from "@conducted/shared";
import type { ReviewerView } from "../../../core/model.ts";

export interface ReviewersListProps {
	reviewers: ReviewerView[];
	reviewDecision: "approved" | "changes_requested" | "review_required" | null;
	canRequestReview: boolean;
	onRequestReview: (login: string) => void;
}

export function ReviewersList(_props: ReviewersListProps): never {
	return notImplemented("PR-04");
}
