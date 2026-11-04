/**
 * @feature PR-07 PrTab
 * Owns: a center tab for the workspace's pull request: editable title and description, activity,
 * checks, review state, merge, and "Open on GitHub". Entry point embedded by the workspace tab
 * strip.
 * Behaviour: ui-map.md 3.2, "Tab content: PR" (PR title editable, Description, Activity, Checks,
 * Review, Merge, Open on GitHub); services-map.md 3.7 (read, edit with `gh pr edit`, merge).
 * Data: useGitState (pullRequest and why it may be missing), useWorkspace (prTitle, prDescription),
 * useActions().pullRequests, usePullRequestActivity (sorted by pr/pr-activity.ts). Reviewers,
 * deployments and viewer rights are fields of PullRequest.
 * Children: PrTitleEditor, PrDescriptionEditor, PrActivityList, PrChecksSummary, PrReviewSection,
 * PrMergeBar, PrEmptyState.
 * Must handle: no PR yet (empty state with Create PR), PR info loading, offline, no GitHub access,
 * a repository without a GitHub remote (the tab explains that it needs one), a merged or closed PR
 * (read-only, no merge), a draft PR (Mark ready first), unsaved title or description edits when the
 * PR changes on GitHub (keep the edit, show a note), and an archived workspace.
 * Test first: with a PR in state "draft" the merge bar shows "Mark ready" and no Merge button.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function PrTab(_props: { workspaceId: WorkspaceId }): never {
	return notImplemented("PR-07");
}
