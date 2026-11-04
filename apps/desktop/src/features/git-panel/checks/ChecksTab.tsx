/**
 * @feature PR-04 Checks tab
 * Owns: the Checks tab body. The PR summary, git status, the checks list with logs, deployments,
 * PR comments and reviewers.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph; services-map.md 3.7.2 (what the poll returns),
 * 3.7.4 (review comments) and 3.7.5 (re-run, failed job log).
 * Data: useGitState (pullRequest, pullRequestUnavailable), useDiffComments (GitHub-origin
 * comments), useActions().pullRequests (rerunFailedChecks, fixErrors) and comments, useCheckLog
 * for a check's log. Reviewers and deployments are fields of PullRequest.
 * Children: PrSummaryHeader, ChecksList, DeploymentsList, PrCommentsList, ReviewersList.
 * Must handle: no PR yet (explain, offer Create PR), PR info loading, offline, no GitHub access
 * (explain how to sign in with `gh auth login`), a repository without a GitHub remote (the tab
 * says checks need GitHub), a merged or closed PR (read-only), checks that never finish, and rate
 * limiting (stale data with a note, not an error).
 * Test first: with a PR that has one failed check, the tab shows the failed check and a "Re-run
 * failed checks" button.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ChecksTabProps {
	workspaceId: WorkspaceId;
}

export function ChecksTab(_props: ChecksTabProps): never {
	return notImplemented("PR-04");
}
