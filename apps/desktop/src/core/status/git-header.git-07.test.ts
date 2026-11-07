/**
 * @feature GIT-07 Resolve conflicts, done by the agent on request
 * Owns: a test that the Git panel header offers the resolve action for a conflicted pull request.
 * Behaviour: ui-map.md 3.6 (header status chip and action), services-map.md 3.7.6 (the app detects
 * conflicts and sends the agent the resolve request).
 * Test first: a conflicted branch has the resolve action, a diverged one has PR-08's incompatibility
 * Resolve instead; a clean tree has neither.
 */
import { describe, expect, it } from "vitest";
import type { GitState, PullRequest } from "../model.ts";
import { computeGitHeader, type GitHeaderInputs } from "./git-header.ts";

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

const OPEN_PULL_REQUEST: PullRequest = {
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
};

const inputs = (git: GitState): GitHeaderInputs => ({
	git,
	agentWorking: false,
	forge: "github",
	automergeSettingOn: false,
	treatOptionalChecksAsBlocking: false,
	stack: null,
});

describe("GIT-07 Git header resolve action", () => {
	it("offers resolve when the branch has conflicts", () => {
		const header = computeGitHeader(inputs(gitState({ hasConflicts: true })));

		expect(header.kind).toBe("conflicts");
		expect(header.action?.id).toBe("resolve");
	});

	it("offers the incompatibility Resolve, not the conflicts one, when the branch has diverged from its remote", () => {
		// Conductor shows the remote's state once the branch has a pull request.
		const header = computeGitHeader(
			inputs(
				gitState({
					sync: { ahead: 1, behind: 1, rewritten: false, hasUpstream: true },
					pullRequest: OPEN_PULL_REQUEST,
				}),
			),
		);

		expect(header.kind).toBe("diverged");
		expect(header.action?.id).toBe("resolve_incompatible");
		expect(header.action?.label).toBe("Resolve");
	});

	it("does not offer resolve when the branch is clean", () => {
		const header = computeGitHeader(inputs(gitState()));

		expect(header.action).toBeNull();
	});
});
