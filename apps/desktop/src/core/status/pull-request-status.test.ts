import { describe, expect, it } from "vitest";
import type { CheckRun, PullRequest } from "../model.ts";
import {
	checksAreFailing,
	checksAreRunning,
	isActivePullRequest,
	isReadyToMerge,
} from "./pull-request-status.ts";

const check = (state: CheckRun["state"]): CheckRun => ({
	name: "ci",
	state,
	url: null,
	startedAt: null,
	completedAt: null,
	required: true,
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

describe("WS-09 pull request predicates", () => {
	it("a closed or merged pull request with failing or running checks is not failing, running or ready", () => {
		for (const state of ["closed", "merged"] as const) {
			const failing = pullRequest({ state, checks: [check("failure")] });
			const running = pullRequest({ state, checks: [check("running")] });
			expect(isActivePullRequest(failing)).toBe(false);
			expect(checksAreFailing(failing)).toBe(false);
			expect(checksAreRunning(running)).toBe(false);
			expect(isReadyToMerge(failing)).toBe(false);
		}
	});

	it("an open or draft pull request reports its checks", () => {
		for (const state of ["open", "draft"] as const) {
			expect(checksAreFailing(pullRequest({ state, checks: [check("cancelled")] }))).toBe(true);
			expect(checksAreRunning(pullRequest({ state, checks: [check("waiting")] }))).toBe(true);
			expect(checksAreFailing(pullRequest({ state, checks: [check("success")] }))).toBe(false);
		}
	});

	it("a pull request with no checks is ready when open and mergeable", () => {
		expect(isReadyToMerge(pullRequest())).toBe(true);
	});
});
