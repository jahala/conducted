import type { FileChange } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import type { ChangesSnapshot } from "../git/status.ts";
import type { PullRequest } from "../model.ts";
import type { WorkspacePrEntry } from "../services/github.ts";
import { computeGitHeader } from "../status/git-header.ts";
import { useGitState } from "./git.ts";

const workspaceId = "ws-1" as WorkspaceId;

let testContainer: TestContainer | null = null;

afterEach(() => {
	testContainer?.close();
	testContainer = null;
	cleanup();
});

function setup(): TestContainer {
	testContainer = createTestContainer();
	return testContainer;
}

function snapshot(overrides: Partial<ChangesSnapshot> = {}): ChangesSnapshot {
	return {
		depth: "full",
		branch: "feat",
		mergeBase: "abc123",
		mergeBaseError: null,
		files: [],
		conflictedPaths: [],
		untrackedTruncated: false,
		uncommittedFiles: 0,
		changedFiles: 0,
		operation: "none",
		commits: [],
		sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
		behindTarget: 0,
		...overrides,
	};
}

function file(path: string, linesAdded: number, linesRemoved: number): FileChange {
	return {
		path,
		status: "modified",
		linesAdded,
		linesRemoved,
		binary: false,
	};
}

function setGit(container: TestContainer, value: ChangesSnapshot | null): void {
	container.container.services.git.store.setState({
		byWorkspace: {
			[workspaceId]: {
				snapshot: value,
				error: null,
				refreshedAt: value === null ? null : 1,
			},
		},
	});
}

function setGitError(container: TestContainer, code: string, message: string): void {
	container.container.services.git.store.setState({
		byWorkspace: {
			[workspaceId]: { snapshot: null, error: { code, message }, refreshedAt: null },
		},
	});
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
	return {
		number: 7,
		url: "https://example.test/pull/7",
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
	};
}

function setPullRequest(
	container: TestContainer,
	value: PullRequest | null,
	unavailable: WorkspacePrEntry["unavailable"] = "none",
): void {
	container.container.services.github.store.setState({
		byWorkspace: { [workspaceId]: { pullRequest: value, unavailable, fetchedAt: 1 } },
	});
}

function renderGitState(container: TestContainer) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container.container}>{children}</ServicesProvider>
	);
	return renderHook(() => useGitState(workspaceId), { wrapper });
}

describe("GIT-04 useGitState", () => {
	it("loads until the first poll stores a snapshot", () => {
		const container = setup();
		const result = renderGitState(container);
		expect(result.result.current).toEqual({ state: "loading" });
	});

	it("returns the recorded poll error when there is no snapshot", () => {
		const container = setup();
		setGitError(container, "git_failed", "The branch could not be read.");
		const result = renderGitState(container);
		expect(result.result.current).toEqual({
			state: "error",
			error: expect.objectContaining({
				code: "git_failed",
				message: "The branch could not be read.",
			}),
		});
	});

	it("merges the polled snapshot with pull request info", () => {
		const container = setup();
		setGit(
			container,
			snapshot({
				branch: "feat",
				files: [file("src/a.ts", 3, 1), file("src/b.ts", 2, 4)],
				uncommittedFiles: 2,
				changedFiles: 2,
				conflictedPaths: ["src/a.ts"],
				operation: "rebase",
				sync: { ahead: 2, behind: 1, rewritten: false, hasUpstream: true },
				untrackedTruncated: true,
			}),
		);
		const pr = pullRequest();
		setPullRequest(container, pr);

		const result = renderGitState(container);
		expect(result.result.current).toEqual({
			state: "ready",
			data: {
				branch: "feat",
				uncommittedFiles: 2,
				changedFiles: 2,
				linesAdded: 5,
				linesRemoved: 5,
				hasConflicts: true,
				operation: "rebase",
				sync: { ahead: 2, behind: 1, rewritten: false, hasUpstream: true },
				pullRequest: pr,
				pullRequestUnavailable: "none",
				untrackedFilesTruncated: true,
				pendingPullRequestAction: null,
			},
		});
	});

	it("shows loading for PR info when GitHub has not answered yet", () => {
		const container = setup();
		setGit(container, snapshot());
		const result = renderGitState(container);
		expect(result.result.current).toMatchObject({
			state: "ready",
			data: { pullRequest: null, pullRequestUnavailable: "loading" },
		});
	});

	it("keeps the reason PR info is missing", () => {
		const container = setup();
		setGit(container, snapshot());
		setPullRequest(container, null, "offline");
		const result = renderGitState(container);
		expect(result.result.current).toMatchObject({
			state: "ready",
			data: { pullRequestUnavailable: "offline" },
		});
	});

	it("reports no missing PR info when GitHub found no pull request", () => {
		const container = setup();
		setGit(container, snapshot());
		setPullRequest(container, null, "no_pr");
		const result = renderGitState(container);
		expect(result.result.current).toMatchObject({
			state: "ready",
			data: { pullRequestUnavailable: "none" },
		});
	});

	it("reads committed changes and a clean tree as two separate counts", () => {
		const container = setup();
		setGit(
			container,
			snapshot({
				files: [file("src/committed.ts", 4, 1)],
				uncommittedFiles: 0,
				changedFiles: 1,
			}),
		);
		setPullRequest(container, null, "no_pr");

		const result = renderGitState(container);
		expect(result.result.current).toMatchObject({
			state: "ready",
			data: { uncommittedFiles: 0, changedFiles: 1 },
		});
		if (result.result.current.state !== "ready") throw new Error("expected a ready state");
		expect(
			computeGitHeader({
				git: result.result.current.data,
				agentWorking: false,
				forge: "github",
				automergeSettingOn: false,
				treatOptionalChecksAsBlocking: false,
				stack: null,
			}).kind,
		).toBe("changes");
	});

	it("loads while a metadata snapshot has read nothing but the branch", () => {
		const container = setup();
		setGit(
			container,
			snapshot({ depth: "metadata", files: [], uncommittedFiles: null, changedFiles: null }),
		);
		const result = renderGitState(container);
		expect(result.result.current).toEqual({ state: "loading" });
	});

	it("loads for an uncommitted snapshot with no full branch comparison", () => {
		const container = setup();
		setGit(container, snapshot({ depth: "uncommitted", uncommittedFiles: 1, changedFiles: null }));
		const result = renderGitState(container);
		expect(result.result.current).toEqual({ state: "loading" });
	});

	it("reports the pull request action running in the GitHub service", () => {
		const container = setup();
		setGit(container, snapshot());
		vi.spyOn(container.container.services.github, "pendingAction").mockReturnValue("merging");
		const result = renderGitState(container);
		expect(result.result.current).toMatchObject({
			state: "ready",
			data: { pendingPullRequestAction: "merging" },
		});
	});

	it("leaves the pull request action null when none is running", () => {
		const container = setup();
		setGit(container, snapshot());
		const state = container.container.services.git.stateOf(workspaceId);
		expect(state?.pendingPullRequestAction).toBeNull();
	});
});
