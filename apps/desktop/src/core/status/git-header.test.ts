import { describe, expect, it } from "vitest";
import type { CheckRun, GitState, PullRequest } from "../model.ts";
import { computeGitHeader, type GitHeaderInputs } from "./git-header.ts";

const check = (state: CheckRun["state"], required = true): CheckRun => ({
	name: "ci",
	state,
	url: null,
	startedAt: null,
	completedAt: null,
	required,
});

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
	number: 1,
	url: "https://example.test/pull/1",
	title: "A change",
	body: "",
	state: "open",
	mergeable: "mergeable",
	reviewDecision: null,
	checks: [],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "octocat",
	viewerDidAuthor: false,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
	...overrides,
});

const gitState = (overrides: Partial<GitState> = {}): GitState => ({
	branch: "feat",
	uncommittedFiles: 0,
	changedFiles: 0,
	linesAdded: 0,
	linesRemoved: 0,
	hasConflicts: false,
	operation: "none",
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
	pullRequest: null,
	pullRequestUnavailable: "none",
	untrackedFilesTruncated: false,
	pendingPullRequestAction: null,
	...overrides,
});

const inputs = (overrides: Partial<GitHeaderInputs> = {}): GitHeaderInputs => ({
	git: gitState(),
	agentWorking: false,
	forge: "github",
	automergeSettingOn: false,
	treatOptionalChecksAsBlocking: false,
	stack: null,
	...overrides,
});

describe("GIT-04 git header state machine", () => {
	it("picks kind, title and action for every state", () => {
		const cases: {
			name: string;
			input: GitHeaderInputs;
			kind: string;
			title: string;
			action: string | null;
		}[] = [
			{
				name: "merged",
				input: inputs({ git: gitState({ pullRequest: pullRequest({ state: "merged" }) }) }),
				kind: "merged",
				title: "Merged",
				action: "continue",
			},
			{
				name: "in merge queue",
				input: inputs({
					git: gitState({ pullRequest: pullRequest({ inMergeQueue: true }) }),
				}),
				kind: "in_merge_queue",
				title: "In merge queue",
				action: null,
			},
			{
				name: "working",
				input: inputs({ agentWorking: true, git: gitState({ uncommittedFiles: 2 }) }),
				kind: "working",
				title: "Working...",
				action: null,
			},
			{
				name: "conflicts",
				input: inputs({ git: gitState({ hasConflicts: true }) }),
				kind: "conflicts",
				title: "Merge conflicts",
				action: "resolve",
			},
			{
				name: "detached",
				input: inputs({ git: gitState({ branch: "", uncommittedFiles: 1 }) }),
				kind: "detached",
				title: "Detached HEAD",
				action: "continue",
			},
			{
				name: "uncommitted",
				input: inputs({ git: gitState({ uncommittedFiles: 1, pullRequest: pullRequest() }) }),
				kind: "uncommitted",
				title: "Uncommitted changes",
				action: "commit_and_push",
			},
			{
				name: "diverged",
				input: inputs({
					git: gitState({
						sync: { ahead: 1, behind: 2, rewritten: false, hasUpstream: true },
						pullRequest: pullRequest(),
					}),
				}),
				kind: "diverged",
				title: "Incompatible with remote",
				action: "resolve_incompatible",
			},
			{
				name: "behind",
				input: inputs({
					git: gitState({
						sync: { ahead: 0, behind: 3, rewritten: false, hasUpstream: true },
						pullRequest: pullRequest(),
					}),
				}),
				kind: "behind",
				title: "Behind by 3 commits",
				action: "pull",
			},
			{
				name: "ahead",
				input: inputs({
					git: gitState({
						sync: { ahead: 2, behind: 0, rewritten: false, hasUpstream: true },
						pullRequest: pullRequest(),
					}),
				}),
				kind: "ahead",
				title: "Ahead by 2 commits",
				action: "push",
			},
			{
				name: "loading",
				input: inputs({ git: gitState({ pullRequestUnavailable: "loading" }) }),
				kind: "loading",
				title: "Loading PR info...",
				action: null,
			},
			{
				name: "offline",
				input: inputs({ git: gitState({ pullRequestUnavailable: "offline" }) }),
				kind: "offline",
				title: "No internet connection",
				action: "retry",
			},
			{
				name: "github access",
				input: inputs({ git: gitState({ pullRequestUnavailable: "no_github_access" }) }),
				kind: "github_access",
				title: "GitHub access required",
				action: "retry",
			},
			{
				name: "PR info unavailable",
				input: inputs({ git: gitState({ pullRequestUnavailable: null }) }),
				kind: "pr_unavailable",
				title: "PR info unavailable",
				action: "retry",
			},
			{
				name: "changes",
				input: inputs({ git: gitState({ changedFiles: 2 }) }),
				kind: "changes",
				title: "",
				action: "create_pr",
			},
			{
				// Conductor's header offers Create PR, with no title, before uncommitted files,
				// conflicts or an unpushed branch whenever there is no pull request yet.
				name: "changes with uncommitted files and no pull request",
				input: inputs({
					agentWorking: true,
					git: gitState({
						changedFiles: 5,
						uncommittedFiles: 3,
						sync: { ahead: 1, behind: 0, rewritten: false, hasUpstream: true },
					}),
				}),
				kind: "changes",
				title: "",
				action: "create_pr",
			},
			{
				name: "changes requested",
				input: inputs({
					git: gitState({
						pullRequest: pullRequest({ reviewDecision: "changes_requested" }),
					}),
				}),
				kind: "changes_requested",
				title: "PR changes requested",
				action: "add_comments_to_chat",
			},
			{
				name: "draft PR",
				input: inputs({ git: gitState({ pullRequest: pullRequest({ state: "draft" }) }) }),
				kind: "draft_pr",
				title: "Draft PR open",
				action: "ready_for_review",
			},
			{
				name: "checks failing",
				input: inputs({
					git: gitState({
						pullRequest: pullRequest({ checks: [check("failure"), check("success")] }),
					}),
				}),
				kind: "checks_failing",
				title: "1 / 2 checks failed",
				action: "fix_errors",
			},
			{
				name: "checks pending",
				input: inputs({
					git: gitState({ pullRequest: pullRequest({ checks: [check("pending")] }) }),
				}),
				kind: "checks_pending",
				title: "1 check pending...",
				action: null,
			},
			{
				name: "review required",
				input: inputs({
					git: gitState({
						pullRequest: pullRequest({ reviewDecision: "review_required" }),
					}),
				}),
				kind: "review_required",
				title: "PR review required",
				action: "approve",
			},
			{
				name: "blocked",
				input: inputs({
					git: gitState({
						pullRequest: pullRequest({ mergeable: "unknown", checks: [check("success")] }),
					}),
				}),
				kind: "blocked",
				title: "Blocked from merging",
				action: null,
			},
			{
				name: "checking mergeability",
				input: inputs({
					git: gitState({ pullRequest: pullRequest({ mergeable: "unknown" }) }),
				}),
				kind: "checking_mergeability",
				title: "Checking mergeability...",
				action: null,
			},
			{
				name: "stack blocked",
				input: inputs({
					git: gitState({ pullRequest: pullRequest() }),
					stack: { mergeCount: 2, blockedReason: "#7 isn't ready to merge" },
				}),
				kind: "stack_blocked",
				title: "#7 isn't ready to merge",
				action: null,
			},
			{
				name: "ready to merge",
				input: inputs({ git: gitState({ pullRequest: pullRequest() }) }),
				kind: "ready_to_merge",
				title: "Ready to merge",
				action: "merge",
			},
			{
				name: "unable",
				input: inputs({ git: gitState({ pullRequest: pullRequest({ state: "closed" }) }) }),
				kind: "unable",
				title: "Unable to merge",
				action: null,
			},
			{
				// Conductor's header is empty on a GitHub branch with no pull request and no changes.
				name: "no pull request and no changes",
				input: inputs(),
				kind: "none",
				title: "",
				action: null,
			},
		];

		for (const entry of cases) {
			const header = computeGitHeader(entry.input);
			expect({
				name: entry.name,
				kind: header.kind,
				title: header.title,
				action: header.action?.id ?? null,
			}).toEqual({
				name: entry.name,
				kind: entry.kind,
				title: entry.title,
				action: entry.action,
			});
		}
	});

	it("shows the rebased title when the remote branch was rewritten", () => {
		const header = computeGitHeader(
			inputs({
				git: gitState({
					sync: { ahead: 1, behind: 1, rewritten: true, hasUpstream: true },
					pullRequest: pullRequest(),
				}),
			}),
		);
		expect(header.kind).toBe("diverged");
		expect(header.title).toBe("Remote branch was rebased");
	});

	it("uses singular commit and check counts", () => {
		expect(
			computeGitHeader(
				inputs({
					git: gitState({
						sync: { ahead: 0, behind: 1, rewritten: false, hasUpstream: true },
						pullRequest: pullRequest(),
					}),
				}),
			).title,
		).toBe("Behind by 1 commit");
		expect(
			computeGitHeader(
				inputs({
					git: gitState({ pullRequest: pullRequest({ checks: [check("running")] }) }),
				}),
			).title,
		).toBe("1 check pending...");
	});

	it("pushes every local commit when the branch has no upstream", () => {
		const header = computeGitHeader(
			inputs({
				git: gitState({
					sync: { ahead: 5, behind: 0, rewritten: false, hasUpstream: false },
					pullRequest: pullRequest(),
				}),
			}),
		);
		expect(header.kind).toBe("ahead");
		expect(header.action?.id).toBe("push");
	});

	it("keeps local actions while the pull request's info refreshes or fails", () => {
		for (const pullRequestUnavailable of [
			"loading",
			"offline",
			"no_github_access",
			null,
		] as const) {
			const header = computeGitHeader(
				inputs({
					git: gitState({
						pullRequestUnavailable,
						uncommittedFiles: 1,
						pullRequest: pullRequest(),
					}),
				}),
			);
			expect(header.kind).toBe("uncommitted");
		}
	});

	it("shows local actions for a repository with no GitHub remote", () => {
		const changes = computeGitHeader(
			inputs({
				git: gitState({ pullRequestUnavailable: "not_github", changedFiles: 2 }),
				forge: "local",
			}),
		);
		expect(changes.kind).toBe("changes");
		expect(changes.action?.id).toBe("create_pr");

		const clean = computeGitHeader(
			inputs({ git: gitState({ pullRequestUnavailable: "not_github" }), forge: "local" }),
		);
		expect(clean.kind).toBe("clean");
	});

	it("does not show a failing state for an optional check unless the setting blocks it", () => {
		const optionalFailure = inputs({
			git: gitState({ pullRequest: pullRequest({ checks: [check("failure", false)] }) }),
		});
		expect(computeGitHeader(optionalFailure).kind).toBe("ready_to_merge");
		expect(computeGitHeader({ ...optionalFailure, treatOptionalChecksAsBlocking: true }).kind).toBe(
			"checks_failing",
		);

		const optionalPending = inputs({
			git: gitState({ pullRequest: pullRequest({ checks: [check("pending", false)] }) }),
		});
		expect(computeGitHeader(optionalPending).kind).toBe("ready_to_merge");
		expect(computeGitHeader({ ...optionalPending, treatOptionalChecksAsBlocking: true }).kind).toBe(
			"checks_pending",
		);
	});

	it("always treats a required check as blocking", () => {
		const header = computeGitHeader(
			inputs({
				git: gitState({ pullRequest: pullRequest({ checks: [check("failure", true)] }) }),
			}),
		);
		expect(header.kind).toBe("checks_failing");
	});

	it("counts pending checks in the failing title", () => {
		const header = computeGitHeader(
			inputs({
				git: gitState({
					pullRequest: pullRequest({
						checks: [check("failure"), check("pending"), check("success")],
					}),
				}),
			}),
		);
		expect(header.title).toBe("1 / 3 checks failed, 1 pending");
		expect(header.action?.id).toBe("fix_errors");
	});

	it("offers the auto-merge toggle only when the setting, forge and viewer allow it", () => {
		const pending = gitState({ pullRequest: pullRequest({ checks: [check("pending")] }) });
		const on = computeGitHeader(inputs({ git: pending, automergeSettingOn: true }));
		expect(on.action?.id).toBe("toggle_automerge");
		expect(on.action?.label).toBe("Enable auto-merge");

		const onWithAutoMerge = computeGitHeader(
			inputs({
				git: gitState({
					pullRequest: pullRequest({ checks: [check("pending")], autoMergeEnabled: true }),
				}),
				automergeSettingOn: true,
			}),
		);
		expect(onWithAutoMerge.action?.label).toBe("Disable auto-merge");

		const noWrite = computeGitHeader(
			inputs({
				git: gitState({
					pullRequest: pullRequest({ checks: [check("pending")], viewerCanMerge: false }),
				}),
				automergeSettingOn: true,
			}),
		);
		expect(noWrite.action).toBeNull();

		const localForge = computeGitHeader(
			inputs({ git: pending, automergeSettingOn: true, forge: "local" }),
		);
		expect(localForge.action).toBeNull();
	});

	it("offers Approve only to a viewer who did not author the pull request", () => {
		const reviewRequired = (overrides: Partial<PullRequest> = {}) =>
			inputs({
				git: gitState({
					pullRequest: pullRequest({ reviewDecision: "review_required", ...overrides }),
				}),
			});

		// A viewer who cannot approve gets no action; our "Waiting for a reviewer" note is gone (D098).
		const author = computeGitHeader(reviewRequired({ viewerDidAuthor: true }));
		expect(author.kind).toBe("review_required");
		expect(author.title).toBe("PR review required");
		expect(author.action).toBeNull();

		const noWrite = computeGitHeader(reviewRequired({ viewerCanMerge: false }));
		expect(noWrite.action).toBeNull();

		const localForge = computeGitHeader({ ...reviewRequired(), forge: "local" });
		expect(localForge.action).toBeNull();

		const reviewer = computeGitHeader(reviewRequired());
		expect(reviewer.action?.id).toBe("approve");
	});

	it("labels Merge with the repository's merge method", () => {
		const labelFor = (mergeMethod: PullRequest["mergeMethod"]) =>
			computeGitHeader(inputs({ git: gitState({ pullRequest: pullRequest({ mergeMethod }) }) }))
				.action?.label;
		expect(labelFor("squash")).toBe("Squash and merge");
		expect(labelFor("rebase")).toBe("Rebase and merge");
		expect(labelFor("merge")).toBe("Create a merge commit");
	});

	it("hides Merge from a viewer without write access", () => {
		const header = computeGitHeader(
			inputs({
				git: gitState({ pullRequest: pullRequest({ viewerCanMerge: false }) }),
			}),
		);
		expect(header.kind).toBe("ready_to_merge");
		expect(header.action).toBeNull();
	});

	it("offers Merge stack for a pull request in a stack", () => {
		const header = computeGitHeader(
			inputs({
				git: gitState({ pullRequest: pullRequest() }),
				stack: { mergeCount: 2, blockedReason: null },
			}),
		);
		expect(header.kind).toBe("ready_to_merge");
		expect(header.action?.id).toBe("merge_stack");
		expect(header.action?.label).toBe("Merge stack");
		expect(header.action?.tooltip).toBe("Merge 2 PRs from bottom to top");
		expect(header.action?.count).toBe(2);
	});

	it("keeps the plain merge when the stack merge would take only this pull request", () => {
		const header = computeGitHeader(
			inputs({
				git: gitState({ pullRequest: pullRequest() }),
				stack: { mergeCount: 1, blockedReason: null },
			}),
		);
		expect(header.action?.id).toBe("merge");
		expect(header.action?.label).toBe("Squash and merge");
		expect(header.action?.tooltip).toBeUndefined();
	});

	it("names a stack blocker only when the pull request itself could merge", () => {
		const blocked = computeGitHeader(
			inputs({
				git: gitState({ pullRequest: pullRequest() }),
				stack: { mergeCount: 2, blockedReason: "Stack needs a rebase" },
			}),
		);
		expect(blocked.kind).toBe("stack_blocked");
		expect(blocked.tone).toBe("attention");
		expect(blocked.action).toBeNull();

		// A pull request that is not ready itself shows its own state, not the stack's.
		const closed = computeGitHeader(
			inputs({
				git: gitState({ pullRequest: pullRequest({ mergeable: "unknown" }) }),
				stack: { mergeCount: 2, blockedReason: "Stack needs a rebase" },
			}),
		);
		expect(closed.kind).toBe("checking_mergeability");
	});

	it("keeps Merge for a local-git forge", () => {
		const header = computeGitHeader(
			inputs({
				git: gitState({ pullRequest: pullRequest(), pullRequestUnavailable: "not_github" }),
				forge: "local",
			}),
		);
		expect(header.kind).toBe("ready_to_merge");
		expect(header.action?.id).toBe("merge");
	});

	it("puts local blockers before remote ones", () => {
		const conflicts = computeGitHeader(
			inputs({
				git: gitState({
					hasConflicts: true,
					uncommittedFiles: 2,
					sync: { ahead: 0, behind: 3, rewritten: false, hasUpstream: true },
				}),
			}),
		);
		expect(conflicts.kind).toBe("conflicts");

		const uncommitted = computeGitHeader(
			inputs({
				git: gitState({
					uncommittedFiles: 1,
					sync: { ahead: 0, behind: 3, rewritten: false, hasUpstream: true },
					pullRequest: pullRequest(),
				}),
			}),
		);
		expect(uncommitted.kind).toBe("uncommitted");
	});

	it("lets Working win without a pull request but not with one", () => {
		const noPullRequest = computeGitHeader(
			inputs({ agentWorking: true, git: gitState({ uncommittedFiles: 1 }) }),
		);
		expect(noPullRequest.kind).toBe("working");

		const withPullRequest = computeGitHeader(
			inputs({ agentWorking: true, git: gitState({ pullRequest: pullRequest() }) }),
		);
		expect(withPullRequest.kind).toBe("ready_to_merge");
	});

	it("shows nothing on a GitHub branch with no pull request and no changes, whatever its sync state", () => {
		for (const git of [
			gitState(),
			gitState({ uncommittedFiles: 2 }),
			gitState({ sync: { ahead: 2, behind: 0, rewritten: false, hasUpstream: true } }),
			gitState({ sync: { ahead: 0, behind: 3, rewritten: false, hasUpstream: true } }),
			gitState({ sync: { ahead: 1, behind: 1, rewritten: true, hasUpstream: true } }),
		]) {
			const header = computeGitHeader(inputs({ git }));
			expect({ kind: header.kind, title: header.title, action: header.action }).toEqual({
				kind: "none",
				title: "",
				action: null,
			});
		}
	});

	it("names a loading or failed pull request read on a GitHub branch with no pull request", () => {
		const titles = (["loading", "offline", "no_github_access", null] as const).map(
			(pullRequestUnavailable) =>
				computeGitHeader(inputs({ git: gitState({ pullRequestUnavailable, uncommittedFiles: 1 }) }))
					.title,
		);
		expect(titles).toEqual([
			"Loading PR info...",
			"No internet connection",
			"GitHub access required",
			"PR info unavailable",
		]);
	});

	it("lets Merged win over every other state", () => {
		const header = computeGitHeader(
			inputs({
				agentWorking: true,
				git: gitState({
					hasConflicts: true,
					uncommittedFiles: 4,
					sync: { ahead: 2, behind: 2, rewritten: true, hasUpstream: true },
					pullRequest: pullRequest({ state: "merged", inMergeQueue: true }),
				}),
			}),
		);
		expect(header.kind).toBe("merged");
		expect(header.action?.id).toBe("continue");
	});

	it("shows a rebase on a detached HEAD as conflicts, not as a place to continue", () => {
		const header = computeGitHeader(inputs({ git: gitState({ branch: "", operation: "rebase" }) }));
		expect(header.kind).toBe("conflicts");
		expect(header.action?.id).toBe("resolve");
	});
});
