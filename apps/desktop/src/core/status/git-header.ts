/**
 * @feature GIT-04 Git panel header state machine
 * Owns: the one rule that turns git and PR state into the header's title, tone and main action.
 * The Git panel header only renders the result; the command palette reads the same action ids.
 * Behaviour: ui-map.md 3.6, table "Header status chip and action"; services-map.md 3.5 to 3.7 (what
 * each action does). Commit, conflict fixes and PR creation are sent to the agent as chat messages
 * (structure-map.md section 6, point 5). Only pull, push, ready, merge, approve and auto-merge run
 * commands directly.
 *
 * The cases, first match wins. The research lists the states but not their order, so the order
 * below is Our design choice: local problems first (they can be seen offline), then PR state.
 * Titles are the research wording; "N" is a count, "M" a total.
 *
 *   kind                  when                                         title                       main action
 *   merged                PR state merged                              Merged                      none
 *   in_merge_queue        PR is in the merge queue                     the queue state text        none
 *   working               agent working and no PR                      Working...                  none
 *   conflicts             conflicted files, or merge/rebase underway,  Merge conflicts             Resolve (agent)
 *                         or PR mergeable is "conflicting"
 *   uncommitted           uncommittedFiles > 0                         Uncommitted changes         Commit and push (agent)
 *   diverged              ahead and behind both > 0, or sync.rewritten Incompatible with remote /  Resolve (agent)
 *                                                                      Remote branch was rebased
 *   behind                sync.behind > 0, ahead is 0                  Behind by N commit(s)       Pull
 *   ahead                 sync.ahead > 0, behind is 0                  Ahead by N commit(s)        Push
 *   loading               pullRequestUnavailable "loading"             Loading PR info...          none
 *   offline               pullRequestUnavailable "offline"             No internet connection      Retry
 *   github_access         pullRequestUnavailable "no_github_access"    GitHub access required      Retry (opens sign-in help)
 *   pr_unavailable        any other missing PR info that is not "no PR yet" PR info unavailable      Retry
 *   changes               no PR, changedFiles > 0                      Changes                     Create PR (agent)
 *   changes_requested     reviewDecision changes_requested             PR changes requested        Add all comments to chat
 *   draft_pr              PR state draft                               Draft PR open               Ready for review
 *   checks_failing        any check failure                            N / M checks failed         Fix errors (agent)
 *                                                                      (plus ", K pending" if any)
 *   checks_pending        any check pending or running                 N checks pending...         Auto-merge toggle, only if
 *                                                                                                  the setting is on and the
 *                                                                                                  repository allows it
 *   review_required       reviewDecision review_required               PR review required          Approve if the viewer may,
 *                                                                                                  otherwise a waiting note
 *   blocked               mergeable unknown for good, or required      Blocked from merging        none
 *                         checks missing
 *   checking_mergeability mergeable "unknown", PR open                 Checking mergeability...    none
 *   stack_blocked         PR is in a stack and a lower PR is not ready A message naming the        none
 *                                                                      blocking PR
 *   ready_to_merge        mergeable, checks pass, no review needed     Ready to merge              Merge (label from the merge
 *                                                                                                  method: squash, rebase or
 *                                                                                                  merge commit), "Merge stack"
 *                                                                                                  when in a stack
 *   unable                closed PR, or no rule above applies          Unable to merge             none
 *   clean                 no PR, no changes, nothing to push or pull   No changes                  none
 *
 * Optional checks: when treatOptionalChecksAsBlocking is on, a failed check with `required: false`
 * counts as failing, so the Merge action stays hidden (ui-map.md 6, Git page).
 * Pluralisation: "1 commit", "2 commits". The title never shows "0".
 *
 * Must handle: PR info missing while local state is fine (still show local actions), the
 * local-git forge with no GitHub remote (a synthesised PR, so no Approve, no auto-merge), a
 * viewer who authored the PR (`viewerDidAuthor`: cannot approve it), a viewer without write access
 * (`viewerCanMerge` false: no Merge), an agent working while files are uncommitted (`working` wins
 * only when there is no PR), a branch with no upstream (ahead counts every local commit, push is
 * the action), and unknown PR info (offline, no access, still loading) showing a loading or retry
 * state, never "clean".
 * Our design choice: the function takes plain values and returns a value; it reads no store and
 * runs no command. The button maps to an action id, and the command registry maps ids to
 * commands, so the palette and the header offer the same actions. Whether a call is in flight is
 * the button's own state, not part of this value.
 * Test first: a table test with one GitHeaderInputs per kind above, asserting kind, title and
 * action id, plus the order cases (conflicts beats uncommitted, uncommitted beats behind), and
 * "uncommitted files and no PR" gives the action "commit_and_push".
 */
import { notImplemented } from "@conducted/shared";
import type { GitState } from "../model.ts";

export type GitHeaderActionId =
	| "create_pr"
	| "commit_and_push"
	| "pull"
	| "push"
	| "resolve"
	| "add_comments_to_chat"
	| "ready_for_review"
	| "fix_errors"
	| "toggle_automerge"
	| "approve"
	| "merge"
	| "merge_stack"
	| "retry";

export type GitHeaderKind =
	| "merged"
	| "in_merge_queue"
	| "working"
	| "conflicts"
	| "uncommitted"
	| "diverged"
	| "behind"
	| "ahead"
	| "loading"
	| "offline"
	| "github_access"
	| "pr_unavailable"
	| "changes"
	| "changes_requested"
	| "draft_pr"
	| "checks_failing"
	| "checks_pending"
	| "review_required"
	| "blocked"
	| "checking_mergeability"
	| "stack_blocked"
	| "ready_to_merge"
	| "unable"
	| "clean";

export type GitHeaderTone = "neutral" | "busy" | "attention" | "danger" | "success" | "done";

export interface GitHeaderAction {
	id: GitHeaderActionId;
	label: string;
	/** Shown instead of a button when the viewer cannot act, e.g. "Waiting for a reviewer". */
	waitingNote: string | null;
}

export interface GitHeader {
	kind: GitHeaderKind;
	title: string;
	tone: GitHeaderTone;
	action: GitHeaderAction | null;
}

export interface GitHeaderInputs {
	/** The PR fields it needs (viewer rights, merge method, checks) are on `git.pullRequest`. */
	git: GitState;
	/** From useWorkspaceStatus: an agent in this workspace is working or waiting on the user. */
	agentWorking: boolean;
	/** "local" is a repository without a GitHub remote (services-map.md 3.7.7). */
	forge: "github" | "local";
	automergeSettingOn: boolean;
	treatOptionalChecksAsBlocking: boolean;
	stack: { size: number; blockedReason: string | null } | null;
}

/** The state machine of ui-map.md 3.6. First matching row wins, in the order of the table above. */
export function computeGitHeader(_inputs: GitHeaderInputs): GitHeader {
	return notImplemented("GIT-04");
}
