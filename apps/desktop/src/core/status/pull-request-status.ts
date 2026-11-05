/**
 * @feature WS-09 Pull request and check predicates shared with GIT-04
 * Owns: the questions the workspace status and the Git panel header both ask about a pull
 * request: whether it is active, whether checks fail or run, whether a review blocks, whether it
 * is ready to merge, and whether git or the pull request has a merge conflict.
 * Behaviour: ui-map.md 3.6 (Git panel header order) and 3.8 (workspace status labels), read from
 * the same pull request fields. GIT-04 imports these so the two rules cannot disagree.
 * Must handle: a closed pull request, which is never active, ready or running; optional checks;
 * a merge or rebase in progress; a pull request with no checks.
 * Our design choice: each predicate takes plain values and returns a boolean. The caller decides
 * which question to ask first.
 * Test first: a closed pull request with failing checks is not failing, ready or running.
 */
import type { GitState, PullRequest } from "../model.ts";

/** Open or draft. A closed or merged pull request is not active. */
export function isActivePullRequest(
	pullRequest: PullRequest | null,
): pullRequest is PullRequest & { state: "open" | "draft" } {
	return pullRequest !== null && (pullRequest.state === "open" || pullRequest.state === "draft");
}

export function checksAreFailing(pullRequest: PullRequest): boolean {
	return pullRequest.checks.some(
		(check) => check.state === "failure" || check.state === "cancelled",
	);
}

export function checksAreRunning(pullRequest: PullRequest): boolean {
	return pullRequest.checks.some(
		(check) => check.state === "pending" || check.state === "waiting" || check.state === "running",
	);
}

export function reviewIsBlocking(pullRequest: PullRequest): boolean {
	return (
		pullRequest.reviewDecision === "changes_requested" ||
		pullRequest.reviewDecision === "review_required"
	);
}

/** Open, mergeable, no blocking review, and no failing or pending checks. */
export function isReadyToMerge(pullRequest: PullRequest): boolean {
	return (
		pullRequest.state === "open" &&
		pullRequest.mergeable === "mergeable" &&
		!reviewIsBlocking(pullRequest) &&
		!checksAreFailing(pullRequest) &&
		!checksAreRunning(pullRequest)
	);
}

/** A merge or rebase in progress, conflicted files, or GitHub saying the PR conflicts. */
export function hasMergeConflict(git: GitState, pullRequest: PullRequest | null): boolean {
	return (
		git.hasConflicts ||
		git.operation === "merge" ||
		git.operation === "rebase" ||
		pullRequest?.mergeable === "conflicting"
	);
}
