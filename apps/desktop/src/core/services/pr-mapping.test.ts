import { describe, expect, it } from "vitest";
import {
	checkStateOfRun,
	type GraphqlPullRequestNode,
	type PullRequestExtras,
	type RawCheckRunNode,
	type RawPullRequest,
	rawFromGraphql,
	summarizeChecks,
	toCheckRuns,
	toPullRequest,
} from "./pr-mapping.ts";

const run = (over: Partial<RawCheckRunNode>): RawCheckRunNode => ({
	name: "build",
	status: "COMPLETED",
	conclusion: "SUCCESS",
	detailsUrl: null,
	startedAt: "2026-01-01T00:00:00Z",
	completedAt: "2026-01-01T00:01:00Z",
	...over,
});

const noneRequired: ReadonlySet<string> = new Set();

describe("toCheckRuns", () => {
	it("keeps only the newest run of one workflow and name", () => {
		const runs = toCheckRuns(
			[
				run({ conclusion: "FAILURE", completedAt: "2026-01-01T00:01:00Z" }),
				run({ conclusion: "SUCCESS", completedAt: "2026-01-01T00:05:00Z" }),
			],
			noneRequired,
		);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.state).toBe("success");
	});

	it("keeps same-named jobs of two workflows apart", () => {
		const runs = toCheckRuns(
			[run({ workflowName: "ci" }), run({ workflowName: "lint" })],
			noneRequired,
		);
		expect(runs).toHaveLength(2);
	});

	it("reads status contexts", () => {
		const [ctx] = toCheckRuns(
			[{ context: "deploy", state: "PENDING", targetUrl: "http://x" }],
			noneRequired,
		);
		expect(ctx).toMatchObject({ name: "deploy", state: "pending", url: "http://x" });
	});

	it("marks the checks the repository requires", () => {
		const runs = toCheckRuns(
			[
				run({ name: "build" }),
				run({ name: "lint" }),
				{ context: "deploy", state: "SUCCESS", targetUrl: null },
			],
			new Set(["build", "deploy"]),
		);
		expect(runs.map((entry) => [entry.name, entry.required])).toEqual([
			["build", true],
			["lint", false],
			["deploy", true],
		]);
	});
});

describe("checkStateOfRun", () => {
	it("maps the unfinished and unusual cases", () => {
		expect(checkStateOfRun(run({ status: "IN_PROGRESS", conclusion: null }))).toBe("running");
		expect(checkStateOfRun(run({ status: "QUEUED", conclusion: null }))).toBe("pending");
		expect(checkStateOfRun(run({ conclusion: "TIMED_OUT" }))).toBe("failure");
		expect(checkStateOfRun(run({ conclusion: "NEUTRAL" }))).toBe("skipped");
		expect(checkStateOfRun(run({ conclusion: "CANCELLED" }))).toBe("cancelled");
	});
});

describe("summarizeChecks", () => {
	it("fails before it pends before it passes", () => {
		const mk = (state: "failure" | "running" | "success") => ({
			name: state,
			state,
			url: null,
			startedAt: null,
			completedAt: null,
			required: false,
		});
		expect(summarizeChecks([mk("success"), mk("running"), mk("failure")]).status).toBe("failing");
		expect(summarizeChecks([mk("success"), mk("running")]).status).toBe("pending");
		expect(summarizeChecks([mk("success")]).status).toBe("passing");
	});
});

describe("toPullRequest", () => {
	const base: RawPullRequest = {
		number: 4,
		url: "https://github.com/o/r/pull/4",
		title: "T",
		body: null,
		state: "OPEN",
		isDraft: true,
		mergeable: null,
		mergeStateStatus: null,
		reviewDecision: null,
		baseRefName: "main",
		headRefOid: "abc",
		viewerDidAuthor: true,
		autoMergeRequest: null,
		mergeQueueEntry: null,
		checks: [],
	};
	const extras: PullRequestExtras = {
		authorLogin: "octocat",
		viewerCanMerge: false,
		mergeMethod: "squash",
		reviewers: [{ login: "hubot", avatarUrl: null, state: "awaiting" }],
		deployments: [],
		updatedAt: 1000,
	};
	const toPr = (raw: RawPullRequest) => toPullRequest(raw, extras, noneRequired);
	it("calls an open draft a draft and fills missing fields explicitly", () => {
		expect(toPr(base)).toMatchObject({
			state: "draft",
			body: "",
			mergeable: "unknown",
			reviewDecision: null,
			inMergeQueue: false,
			autoMergeEnabled: false,
			viewerDidAuthor: true,
		});
	});
	it("carries the fields the caller learned elsewhere", () => {
		expect(toPr(base)).toMatchObject(extras);
	});
	it("does not call a merged draft a draft", () => {
		expect(toPr({ ...base, state: "MERGED" }).state).toBe("merged");
	});
	it("flags queue and auto-merge", () => {
		const pr = toPr({
			...base,
			isDraft: false,
			autoMergeRequest: { enabledAt: "x" },
			mergeQueueEntry: { state: "QUEUED", position: 1 },
		});
		expect(pr).toMatchObject({ inMergeQueue: true, autoMergeEnabled: true, state: "open" });
	});
});

describe("rawFromGraphql", () => {
	const node: GraphqlPullRequestNode = {
		number: 9,
		url: "u",
		title: "T",
		body: "b",
		state: "OPEN",
		isDraft: false,
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		reviewDecision: null,
		baseRefName: "main",
		headRefOid: "abc",
		viewerDidAuthor: false,
		autoMergeRequest: null,
		mergeQueueEntry: null,
		headRef: {
			target: {
				statusCheckRollup: {
					contexts: {
						nodes: [
							{
								name: "build",
								status: "COMPLETED",
								conclusion: "SUCCESS",
								detailsUrl: null,
								startedAt: null,
								completedAt: null,
								checkSuite: { workflowRun: { workflow: { name: "ci" } } },
							},
							{ context: "deploy", state: "SUCCESS", targetUrl: null },
						],
					},
				},
			},
		},
	};
	it("lifts the workflow name and keeps status contexts", () => {
		const raw = rawFromGraphql(node);
		expect(raw.checks).toHaveLength(2);
		expect(raw.checks[0]).toMatchObject({ name: "build", workflowName: "ci" });
		expect(raw.checks[1]).toMatchObject({ context: "deploy" });
	});
	it("handles a branch with no checks", () => {
		expect(rawFromGraphql({ ...node, headRef: null }).checks).toEqual([]);
		expect(
			rawFromGraphql({ ...node, headRef: { target: { statusCheckRollup: null } } }).checks,
		).toEqual([]);
	});
});
