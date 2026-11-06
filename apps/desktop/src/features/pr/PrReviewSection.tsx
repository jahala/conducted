/**
 * @feature PR-07 PR review section
 * Owns: the Review block of the PR tab. Review decision, reviewers, the Approve action, and
 * asking for or removing a reviewer.
 * Behaviour: ui-map.md 3.2 (PR tab: Review) and 3.6 (Approve if reviewer, else waiting text);
 * services-map.md 3.7.5 (approve is pinned to the head commit; reviewers are added and removed
 * with `gh pr edit`).
 * Must handle: the viewer being the author (no Approve), an already approved pull request (no
 * Approve), changes requested, review not required, approval failing (the caller keeps the button
 * usable), and a review request or removal with no login typed.
 * Test first: when viewerDidAuthor is true there is no Approve button.
 */
import { useState } from "react";
import type { PullRequest } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Input } from "../../ui/Input.tsx";
import { reviewerStateLabel } from "../git-panel/checks/ReviewersList.tsx";

export interface PrReviewSectionProps {
	pullRequest: PullRequest;
	approveBusy: boolean;
	onApprove: () => void;
	/** Asks this GitHub user for a review. Left out, no request form is shown. */
	onRequestReview?: (login: string) => void;
	/** Removes this reviewer from the pull request. Left out, no Remove button is shown. */
	onRemoveReview?: (login: string) => void;
}

const DECISION_LABEL: Readonly<Record<NonNullable<PullRequest["reviewDecision"]>, string>> = {
	approved: "Approved",
	changes_requested: "Changes requested",
	review_required: "Review required",
};

export function PrReviewSection({
	pullRequest,
	approveBusy,
	onApprove,
	onRequestReview,
	onRemoveReview,
}: PrReviewSectionProps) {
	const [login, setLogin] = useState("");
	const decision =
		pullRequest.reviewDecision === null ? null : DECISION_LABEL[pullRequest.reviewDecision];
	const canApprove =
		!pullRequest.viewerDidAuthor &&
		pullRequest.state === "open" &&
		pullRequest.reviewDecision !== "approved";
	const waitingText = pullRequest.viewerDidAuthor
		? "You opened this pull request, so you cannot approve it."
		: pullRequest.reviewDecision === "approved"
			? "This pull request is approved."
			: null;

	const submitRequest = () => {
		const trimmed = login.trim();
		if (trimmed === "" || onRequestReview === undefined) return;
		onRequestReview(trimmed);
		setLogin("");
	};

	return (
		<div className="px-2 py-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-medium text-fg">Review</h3>
				{decision === null ? null : <span className="text-xs text-fg-muted">{decision}</span>}
			</div>
			{pullRequest.reviewers.length === 0 ? (
				<p className="mt-1 text-xs text-fg-muted">
					{pullRequest.reviewDecision === null ? "No review required." : "No reviewers requested."}
				</p>
			) : (
				<ul className="mt-1 space-y-1">
					{pullRequest.reviewers.map((reviewer) => (
						<li key={reviewer.login} className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate text-sm text-fg">{reviewer.login}</span>
							<span className="text-xs text-fg-muted">{reviewerStateLabel(reviewer.state)}</span>
							{onRemoveReview === undefined ? null : (
								<Button
									variant="ghost"
									size="xs"
									aria-label={`Remove ${reviewer.login}`}
									onClick={() => onRemoveReview(reviewer.login)}
								>
									Remove
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
			<div className="mt-2 flex items-center gap-2">
				{canApprove ? (
					<Button variant="outline" size="sm" loading={approveBusy} onClick={onApprove}>
						Approve
					</Button>
				) : waitingText === null ? null : (
					<p className="text-xs text-fg-muted">{waitingText}</p>
				)}
				{onRequestReview === undefined ? null : (
					<div className="ml-auto flex items-center gap-1">
						<Input
							aria-label="Reviewer"
							placeholder="GitHub username"
							value={login}
							onChange={(event) => setLogin(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") submitRequest();
							}}
							className="h-7 w-40 text-xs"
						/>
						<Button variant="outline" size="xs" onClick={submitRequest}>
							Request review
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
