import { appError } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { GitState } from "../model.ts";
import { computeGitHeader, type GitHeaderInputs } from "./git-header.ts";

const gitState = (overrides: Partial<GitState> = {}): GitState => ({
	branch: "feat",
	uncommittedFiles: 0,
	changedFiles: 0,
	linesAdded: 0,
	linesRemoved: 0,
	hasConflicts: false,
	operation: "none",
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: false },
	pullRequest: null,
	pullRequestUnavailable: "not_github",
	untrackedFilesTruncated: false,
	pendingPullRequestAction: null,
	...overrides,
});

const inputs = (overrides: Partial<GitHeaderInputs> = {}): GitHeaderInputs => ({
	git: gitState(),
	agentWorking: false,
	forge: "local",
	automergeSettingOn: false,
	treatOptionalChecksAsBlocking: false,
	stack: null,
	...overrides,
});

describe("GIT-14 local-git forge header", () => {
	it("offers Merge when the local branch is ahead with no predicted conflict", () => {
		const header = computeGitHeader(
			inputs({ localForge: { ahead: 2, behind: 0, mergeState: "CLEAN" } }),
		);

		expect(header.kind).toBe("ready_to_merge");
		expect(header.action?.id).toBe("merge");
		expect(header.action?.label).toBe("Merge");
	});

	it("shows Merge conflicts and Resolve when the merge probe predicts a conflict", () => {
		const header = computeGitHeader(
			inputs({ localForge: { ahead: 1, behind: 0, mergeState: "DIRTY" } }),
		);

		expect(header.kind).toBe("conflicts");
		expect(header.action?.id).toBe("resolve");
	});

	it("shows no changes when the local branch has nothing ahead", () => {
		const header = computeGitHeader(
			inputs({ localForge: { ahead: 0, behind: 2, mergeState: null } }),
		);

		expect(header.kind).toBe("clean");
		expect(header.action).toBeNull();
	});

	it("loads the local forge without offering Create PR", () => {
		const loading = computeGitHeader(inputs({ localForge: null }));

		expect(loading.kind).toBe("loading");
		expect(loading.action).toBeNull();
	});

	it("offers Retry when the local forge could not read the workspace", () => {
		const failed = computeGitHeader(
			inputs({
				localForge: null,
				localForgeError: appError("git_failed", "git rev-list failed"),
			}),
		);

		expect(failed.kind).toBe("pr_unavailable");
		expect(failed.action?.id).toBe("retry");
	});
});
