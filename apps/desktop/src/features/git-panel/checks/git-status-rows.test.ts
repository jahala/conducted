/**
 * Tests for PR-04: the Checks tab's Git status rows follow Conductor's wording and order.
 */

import type { CommentId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { CheckRun, DiffComment, GitState, PullRequest } from "../../../core/model.ts";
import { commentsToAddToChat, gitStatusRows } from "./git-status-rows.ts";

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

const texts = (git: GitState, optionalBlocking = false) =>
	gitStatusRows(git, optionalBlocking, 0).map((row) => row.text);

describe("PR-04 Git status rows", () => {
	it("gives a draft pull request with two uncommitted files its two rows, in Conductor's order", () => {
		const rows = gitStatusRows(
			gitState({ uncommittedFiles: 2, pullRequest: pullRequest({ state: "draft" }) }),
			false,
			0,
		);

		expect(rows.map((row) => [row.text, row.action?.label ?? null])).toEqual([
			["PR is in draft", "Ready for review"],
			["2 uncommitted changes", "Commit and push"],
		]);
	});

	it("offers Create PR with no pull request, and counts commits behind and ahead of remote", () => {
		expect(
			texts(gitState({ sync: { ahead: 1, behind: 3, rewritten: false, hasUpstream: true } })),
		).toEqual(["No PR open", "3 commits behind remote", "1 commit ahead of remote"]);
	});

	it("leaves out the ahead row while there is something to commit", () => {
		expect(
			texts(
				gitState({
					uncommittedFiles: 1,
					sync: { ahead: 2, behind: 0, rewritten: false, hasUpstream: true },
				}),
			),
		).toEqual(["No PR open", "1 uncommitted change"]);
	});

	it("says Ready to merge only when nothing is left to do", () => {
		expect(texts(gitState({ pullRequest: pullRequest() }))).toEqual(["Ready to merge"]);
		expect(texts(gitState({ pullRequest: pullRequest({ checks: [check("failure")] }) }))).toEqual(
			[],
		);
		expect(
			texts(gitState({ pullRequest: pullRequest({ checks: [check("failure", false)] }) })),
		).toEqual(["Ready to merge"]);
		expect(
			texts(gitState({ pullRequest: pullRequest({ checks: [check("failure", false)] }) }), true),
		).toEqual([]);
		expect(texts(gitState({ pullRequest: pullRequest({ viewerCanMerge: false }) }))).toEqual([]);
	});

	it("names conflicts, a rewritten remote and the review state", () => {
		expect(
			texts(
				gitState({
					sync: { ahead: 0, behind: 0, rewritten: true, hasUpstream: true },
					pullRequest: pullRequest({ mergeable: "conflicting", reviewDecision: "review_required" }),
				}),
			),
		).toEqual(["Merge conflicts detected", "Incompatible with remote", "Waiting for PR review"]);
		const changes = gitStatusRows(
			gitState({ pullRequest: pullRequest({ reviewDecision: "changes_requested" }) }),
			false,
			1,
		);
		expect(changes.map((row) => [row.text, row.action?.id])).toEqual([
			["PR changes requested", "add_comments_to_chat"],
		]);
	});

	it("offers Add all comments to chat only while a review comment is not in the chat yet", () => {
		const changes = gitStatusRows(
			gitState({ pullRequest: pullRequest({ reviewDecision: "changes_requested" }) }),
			false,
			0,
		);
		expect(changes.map((row) => [row.text, row.action])).toEqual([["PR changes requested", null]]);
	});

	it("shows no pull request rows once it is merged", () => {
		expect(texts(gitState({ pullRequest: pullRequest({ state: "merged" }) }))).toEqual([]);
	});
});

const comment = (id: string, overrides: Partial<DiffComment> = {}): DiffComment => ({
	id: id as CommentId,
	workspaceId: "w1" as WorkspaceId,
	filePath: "src/a.ts",
	line: 4,
	endLine: null,
	body: "Please rename this.",
	author: { kind: "github", name: "lee", avatarUrl: null },
	state: "pending",
	side: "additions",
	threadId: `thread-${id}`,
	replyToId: null,
	suggestion: null,
	suggestionBaseCode: null,
	remoteUrl: null,
	resolved: false,
	outdated: false,
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

describe("GIT-04 the review comments Add all comments to chat sends", () => {
	it("takes the open GitHub comments that are not in the chat yet", () => {
		expect(
			commentsToAddToChat([
				comment("open"),
				comment("mine", { author: { kind: "user", name: null, avatarUrl: null } }),
				comment("reply", { replyToId: "open" as CommentId }),
				comment("resolved", { resolved: true }),
				comment("outdated", { outdated: true }),
				comment("sent", { state: "reviewed" }),
				comment("hidden", { state: "hidden" }),
				comment("superseded", { state: "superseded" }),
			]),
		).toEqual(["open"]);
	});
});
