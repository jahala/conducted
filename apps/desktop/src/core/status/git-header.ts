/**
 * @feature GIT-04 Git panel header state machine
 * Owns: the one rule that turns git and PR state into the header's title, tone and main action.
 * The Git panel header only renders the result; its button maps each action id to a command, so
 * the palette and the header offer the same actions.
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
 *   merged                PR state merged                              Merged                      Continue (GIT-17)
 *   in_merge_queue        PR is in the merge queue                     In merge queue              none
 *   working               agent working and no PR                      Working...                  none
 *   conflicts             conflicted files, or merge/rebase underway,  Merge conflicts             Resolve (agent)
 *                         or PR mergeable is "conflicting"
 *   detached              no branch is checked out (detached HEAD)     Detached HEAD               Continue (GIT-17)
 *   uncommitted           uncommittedFiles > 0                         Uncommitted changes         Commit and push (agent)
 *   conflicts             local-git forge, mergeState DIRTY            Merge conflicts             Resolve (agent)
 *   ready_to_merge        local-git forge, ahead > 0                   Ready to merge              Merge (agent)
 *   pr_unavailable        local-git forge, info could not be read      PR info unavailable         Retry
 *   loading               local-git forge, info not read yet           Loading PR info...          none
 *   changes / clean       local-git forge, nothing ahead               Changes / No changes        none
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
 *   draft_pr              PR state draft                               Draft PR open               Ready for review, if the
 *                                                                                                  forge can mark ready
 *   checks_failing        any check failure                            N / M checks failed         Fix errors (agent)
 *                                                                      (plus ", K pending" if any)
 *   checks_pending        any check pending or running                 N checks pending...         Auto-merge toggle, only if
 *                                                                                                  the setting is on, the forge
 *                                                                                                  can auto-merge and the viewer
 *                                                                                                  may merge
 *   review_required       reviewDecision review_required               PR review required          Approve if the forge can make
 *                                                                                                  remote requests and the viewer
 *                                                                                                  may, otherwise a waiting note
 *   blocked               mergeable unknown after checks reported,     Blocked from merging        none
 *                         or a required check was skipped
 *   checking_mergeability mergeable "unknown", no checks reported yet  Checking mergeability...    none
 *   stack_blocked         ready to merge, but its stack is not: a      Stack needs a rebase /      none
 *                         draft, a lower PR not ready, or a branch     #N is still a draft /
 *                         not on the head below it                     #N isn't ready to merge
 *   ready_to_merge        mergeable, checks pass, no review needed     Ready to merge              Merge (label from the merge
 *                                                                                                  method: squash, rebase or
 *                                                                                                  merge commit), or "Merge
 *                                                                                                  stack" with the tooltip
 *                                                                                                  "Merge N PRs from bottom to
 *                                                                                                  top" when the stack merge
 *                                                                                                  takes more than one PR
 *   unable                closed PR, or no rule above applies          Unable to merge             none
 *   clean                 no PR, no changes, nothing to push or pull   No changes                  none
 *
 * Optional checks: when treatOptionalChecksAsBlocking is on, a failed or pending check with
 * `required: false` counts as blocking, so the Merge action stays hidden (ui-map.md 6, Git page).
 * Pluralisation: "1 commit", "2 commits". The title never shows "0".
 *
 * Must handle: PR info missing while local state is fine (still show local actions), the
 * local-git forge with no GitHub remote (a synthesised PR, so no Approve, no auto-merge; Merge
 * is still the agent instruction of services-map.md 3.7.7), a
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
import type { AppError } from "@conducted/shared";
import type { CheckRun, GitState, PullRequest } from "../model.ts";
import { capabilitiesFor, type LocalPrInfo } from "../services/local-git-forge.ts";
import { hasMergeConflict, isActivePullRequest, reviewIsBlocking } from "./pull-request-status.ts";

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
	| "retry"
	| "continue";

export type GitHeaderKind =
	| "merged"
	| "in_merge_queue"
	| "working"
	| "conflicts"
	| "detached"
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
	/** The button's tooltip, when it says more than the label ("Merge 3 PRs from bottom to top"). */
	tooltip?: string;
	/** A number the button shows next to its label: the pull requests a stack merge takes. */
	count?: number;
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
	/**
	 * The synthesised local-git pull request, when the switch is on and the caller asked for it.
	 * `null` means it is still being read; `undefined` means this caller does not use the forge.
	 */
	localForge?: LocalPrInfo | null;
	/** Why the synthesised local-git information could not be read. */
	localForgeError?: AppError | null;
	automergeSettingOn: boolean;
	treatOptionalChecksAsBlocking: boolean;
	/**
	 * The GitHub stack the pull request is in, from core/status/stack-readiness.ts: how many pull
	 * requests a stack merge takes, and the header's title when an entry blocks it. Null outside a
	 * stack.
	 */
	stack: { mergeCount: number; blockedReason: string | null } | null;
}

function action(
	id: GitHeaderActionId,
	label: string,
	waitingNote: string | null = null,
): GitHeaderAction {
	return { id, label, waitingNote };
}

function commitCount(count: number): string {
	return `${count} commit${count === 1 ? "" : "s"}`;
}

function checkCount(count: number): string {
	return `${count} check${count === 1 ? "" : "s"}`;
}

/** GitHub's button text for each merge method. */
function mergeLabel(method: PullRequest["mergeMethod"]): string {
	switch (method) {
		case "squash":
			return "Squash and merge";
		case "rebase":
			return "Rebase and merge";
		case "merge":
			return "Create a merge commit";
	}
}

/**
 * Required checks always count. Optional ones count only when the setting says so. The one home
 * of this rule: the Checks tab's summary uses it too.
 */
export function countsAsBlocking(check: CheckRun, treatOptionalChecksAsBlocking: boolean): boolean {
	return check.required || treatOptionalChecksAsBlocking;
}

function failingChecks(
	pullRequest: PullRequest,
	treatOptionalChecksAsBlocking: boolean,
): CheckRun[] {
	return pullRequest.checks.filter(
		(check) =>
			countsAsBlocking(check, treatOptionalChecksAsBlocking) &&
			(check.state === "failure" || check.state === "cancelled"),
	);
}

function pendingChecks(
	pullRequest: PullRequest,
	treatOptionalChecksAsBlocking: boolean,
): CheckRun[] {
	return pullRequest.checks.filter(
		(check) =>
			countsAsBlocking(check, treatOptionalChecksAsBlocking) &&
			(check.state === "pending" || check.state === "waiting" || check.state === "running"),
	);
}

/** A required check that GitHub skipped, which keeps the pull request from merging. */
function hasSkippedRequiredCheck(pullRequest: PullRequest): boolean {
	return pullRequest.checks.some((check) => check.required && check.state === "skipped");
}

/** The state machine of ui-map.md 3.6. First matching row wins, in the order of the table above. */
export function computeGitHeader(inputs: GitHeaderInputs): GitHeader {
	const {
		git,
		agentWorking,
		forge,
		localForge,
		localForgeError,
		automergeSettingOn,
		treatOptionalChecksAsBlocking,
		stack,
	} = inputs;
	const pullRequest = git.pullRequest;
	const active = isActivePullRequest(pullRequest) ? pullRequest : null;
	// What the forge can do decides which remote actions the header offers (services-map 5B.1.5).
	const can = capabilitiesFor(forge);

	// Continue starts a new branch in the same workspace (services-map.md 3.1).
	if (pullRequest?.state === "merged") {
		return {
			kind: "merged",
			title: "Merged",
			tone: "done",
			action: action("continue", "Continue"),
		};
	}
	if (active?.inMergeQueue === true) {
		return { kind: "in_merge_queue", title: "In merge queue", tone: "busy", action: null };
	}
	if (agentWorking && pullRequest === null) {
		return { kind: "working", title: "Working...", tone: "busy", action: null };
	}
	if (hasMergeConflict(git, pullRequest)) {
		return {
			kind: "conflicts",
			title: "Merge conflicts",
			tone: "danger",
			action: action("resolve", "Resolve"),
		};
	}
	// A rebase or merge also detaches HEAD; those are conflicts above, not a place to continue.
	if (git.branch === "") {
		return {
			kind: "detached",
			title: "Detached HEAD",
			tone: "attention",
			action: action("continue", "Continue"),
		};
	}
	if (git.uncommittedFiles > 0) {
		return {
			kind: "uncommitted",
			title: "Uncommitted changes",
			tone: "attention",
			action: action("commit_and_push", "Commit and push"),
		};
	}
	// The local-git forge stands in for a pull request: commits ahead of the target are ready to
	// merge, and a predicted conflict is the conflicts state. The switch off means no info was
	// asked for, and the plain "no GitHub remote" states below apply.
	if (forge === "local" && localForge !== undefined) {
		if (localForge === null) {
			if (localForgeError !== undefined && localForgeError !== null) {
				return {
					kind: "pr_unavailable",
					title: "PR info unavailable",
					tone: "danger",
					action: action("retry", "Retry"),
				};
			}
			return { kind: "loading", title: "Loading PR info...", tone: "busy", action: null };
		}
		if (localForge.mergeState === "DIRTY") {
			return {
				kind: "conflicts",
				title: "Merge conflicts",
				tone: "danger",
				action: action("resolve", "Resolve"),
			};
		}
		if (localForge.ahead > 0) {
			return {
				kind: "ready_to_merge",
				title: "Ready to merge",
				tone: "success",
				action: action("merge", "Merge"),
			};
		}
		if (git.changedFiles > 0) {
			return { kind: "changes", title: "Changes", tone: "neutral", action: null };
		}
		return { kind: "clean", title: "No changes", tone: "neutral", action: null };
	}
	if ((git.sync.ahead > 0 && git.sync.behind > 0) || git.sync.rewritten) {
		return {
			kind: "diverged",
			title: git.sync.rewritten ? "Remote branch was rebased" : "Incompatible with remote",
			tone: "danger",
			action: action("resolve", "Resolve"),
		};
	}
	if (git.sync.behind > 0 && git.sync.ahead === 0) {
		return {
			kind: "behind",
			title: `Behind by ${commitCount(git.sync.behind)}`,
			tone: "attention",
			action: action("pull", "Pull"),
		};
	}
	if (git.sync.ahead > 0 && git.sync.behind === 0) {
		return {
			kind: "ahead",
			title: `Ahead by ${commitCount(git.sync.ahead)}`,
			tone: "attention",
			action: action("push", "Push"),
		};
	}

	if (pullRequest === null) {
		switch (git.pullRequestUnavailable) {
			case "loading":
				return { kind: "loading", title: "Loading PR info...", tone: "busy", action: null };
			case "offline":
				return {
					kind: "offline",
					title: "No internet connection",
					tone: "attention",
					action: action("retry", "Retry"),
				};
			case "no_github_access":
				return {
					kind: "github_access",
					title: "GitHub access required",
					tone: "danger",
					action: action("retry", "Retry"),
				};
			case null:
				return {
					kind: "pr_unavailable",
					title: "PR info unavailable",
					tone: "danger",
					action: action("retry", "Retry"),
				};
			case "none":
			case "not_github":
				break;
		}
		if (git.changedFiles > 0) {
			return {
				kind: "changes",
				title: "Changes",
				tone: "neutral",
				action: action("create_pr", "Create PR"),
			};
		}
		return { kind: "clean", title: "No changes", tone: "neutral", action: null };
	}

	// A closed pull request has no action left.
	if (active === null) {
		return { kind: "unable", title: "Unable to merge", tone: "danger", action: null };
	}

	const failing = failingChecks(active, treatOptionalChecksAsBlocking);
	const pending = pendingChecks(active, treatOptionalChecksAsBlocking);

	if (active.reviewDecision === "changes_requested") {
		return {
			kind: "changes_requested",
			title: "PR changes requested",
			tone: "attention",
			action: action("add_comments_to_chat", "Add all comments to chat"),
		};
	}
	if (active.state === "draft") {
		return {
			kind: "draft_pr",
			title: "Draft PR open",
			tone: "neutral",
			action: can.markReady ? action("ready_for_review", "Ready for review") : null,
		};
	}
	if (failing.length > 0) {
		const pendingNote = pending.length > 0 ? `, ${pending.length} pending` : "";
		return {
			kind: "checks_failing",
			title: `${failing.length} / ${active.checks.length} checks failed${pendingNote}`,
			tone: "danger",
			action: action("fix_errors", "Fix errors"),
		};
	}
	if (pending.length > 0) {
		return {
			kind: "checks_pending",
			title: `${checkCount(pending.length)} pending...`,
			tone: "busy",
			action:
				automergeSettingOn && can.autoMerge && active.viewerCanMerge
					? action(
							"toggle_automerge",
							active.autoMergeEnabled ? "Disable auto-merge" : "Enable auto-merge",
						)
					: null,
		};
	}
	if (active.reviewDecision === "review_required") {
		const canApprove = can.remoteRequests && active.viewerCanMerge && !active.viewerDidAuthor;
		return {
			kind: "review_required",
			title: "PR review required",
			tone: "attention",
			action: action("approve", "Approve", canApprove ? null : "Waiting for a reviewer"),
		};
	}

	// Our model has no mergeStateStatus. A mergeability that is still unknown after checks have
	// reported, or a skipped required check, is what GitHub calls blocked.
	if (
		hasSkippedRequiredCheck(active) ||
		(active.mergeable === "unknown" && active.checks.length > 0)
	) {
		return { kind: "blocked", title: "Blocked from merging", tone: "attention", action: null };
	}
	if (active.mergeable === "unknown") {
		return {
			kind: "checking_mergeability",
			title: "Checking mergeability...",
			tone: "busy",
			action: null,
		};
	}
	const ready =
		active.state === "open" &&
		active.mergeable === "mergeable" &&
		!reviewIsBlocking(active) &&
		failing.length === 0 &&
		pending.length === 0;
	if (ready) {
		// A pull request that could merge on its own still waits for the stack below it.
		if (stack !== null && stack.blockedReason !== null) {
			return { kind: "stack_blocked", title: stack.blockedReason, tone: "attention", action: null };
		}
		// A stack merge takes every open pull request from the bottom up to this one.
		const stackCount = stack !== null && stack.mergeCount > 1 ? stack.mergeCount : null;
		const mergeAction =
			active.viewerCanMerge === false
				? null
				: stackCount !== null
					? {
							...action("merge_stack", "Merge stack"),
							tooltip: `Merge ${stackCount} PRs from bottom to top`,
							count: stackCount,
						}
					: action("merge", mergeLabel(active.mergeMethod));
		return {
			kind: "ready_to_merge",
			title: "Ready to merge",
			tone: "success",
			action: mergeAction,
		};
	}

	return { kind: "unable", title: "Unable to merge", tone: "danger", action: null };
}
