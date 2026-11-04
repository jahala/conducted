/**
 * @feature PR-07 PR review section
 * Owns: the Review block of the PR tab. Review decision, reviewers, and the Approve action.
 * Behaviour: ui-map.md 3.2 (PR tab: Review) and 3.6 (Approve if reviewer, else waiting text);
 * services-map.md 3.7.5 (approve is pinned to the head commit).
 * Must handle: the viewer being the author (no Approve), a head commit that moved since the viewer
 * last looked (Approve asks again), changes requested, review not required, and approval failing.
 * Test first: when viewerDidAuthor is true there is no Approve button.
 */
import { notImplemented } from "@conducted/shared";
import type { PullRequest } from "../../core/model.ts";

export interface PrReviewSectionProps {
	pullRequest: PullRequest;
	approveBusy: boolean;
	onApprove: () => void;
}

export function PrReviewSection(_props: PrReviewSectionProps): never {
	return notImplemented("PR-07");
}
