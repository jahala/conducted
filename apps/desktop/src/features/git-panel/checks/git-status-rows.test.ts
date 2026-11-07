/**
 * Tests for PR-04: the Checks tab's Git status rows follow Conductor's wording and order.
 */
import { describe, expect, it } from "vitest";
import type { CheckRun, GitState, PullRequest } from "../../../core/model.ts";
import { gitStatusRows } from "./git-status-rows.ts";

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
	gitStatusRows(git, optionalBlocking).map((row) => row.text);

describe("PR-04 Git status rows", () => {
	it("gives a draft pull request with two uncommitted files its two rows, in Conductor's order", () => {
		const rows = gitStatusRows(
			gitState({ uncommittedFiles: 2, pullRequest: pullRequest({ state: "draft" }) }),
			false,
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
		);
		expect(changes.map((row) => [row.text, row.action?.id])).toEqual([
			["PR changes requested", "add_comments_to_chat"],
		]);
	});

	it("shows no pull request rows once it is merged", () => {
		expect(texts(gitState({ pullRequest: pullRequest({ state: "merged" }) }))).toEqual([]);
	});
});
