import { describe, expect, it } from "vitest";
import {
	checkStateOfContext,
	checkStateOfRun,
	closedPrIsShown,
	deploymentProviderOf,
	deploymentStateOf,
	type GraphqlPullRequestNode,
	headBranchFromUpstream,
	rawFromGraphql,
	reconcileMergeable,
	reviewerStateOf,
	summarizeChecks,
	toDeployments,
	toReviewers,
} from "./pr-mapping.ts";

const check = (state: "failure" | "pending" | "running" | "waiting" | "success") => ({
	name: state,
	state,
	url: null,
	startedAt: null,
	completedAt: null,
	required: false,
});

const node: GraphqlPullRequestNode = {
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "T",
	body: "b",
	state: "OPEN",
	isDraft: false,
	mergeable: "MERGEABLE",
	mergeStateStatus: "BLOCKED",
	reviewDecision: "REVIEW_REQUIRED",
	baseRefName: "main",
	baseRef: { target: { oid: "base-1" } },
	headRefName: "feature/as-pushed",
	headRefOid: "head-1",
	author: { login: "octocat", avatarUrl: "a" },
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-02T00:00:00Z",
	viewerDidAuthor: false,
	viewerLatestReview: { state: "COMMENTED", commit: { oid: "head-1" } },
	reviewRequests: {
		nodes: [
			{ requestedReviewer: { login: "hubot", avatarUrl: "h" } },
			{ requestedReviewer: { slug: "platform" } },
		],
	},
	latestReviews: {
		nodes: [
			{ author: { login: "hubot", avatarUrl: "h" }, state: "APPROVED", submittedAt: "x" },
			{ author: { login: "mona" }, state: "CHANGES_REQUESTED", submittedAt: "y" },
		],
	},
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
					],
				},
			},
			deployments: {
				nodes: [
					{
						environment: "Production",
						updatedAt: "2026-01-02T00:00:00Z",
						latestStatus: {
							state: "SUCCESS",
							environmentUrl: "https://shop.vercel.app",
							updatedAt: "2026-01-02T00:00:00Z",
						},
					},
				],
			},
		},
	},
};

describe("PR-03 checks summary", () => {
	it("a CLEAN merge state forces passing even with a failed run", () => {
		expect(summarizeChecks([check("failure"), check("pending")], "CLEAN").status).toBe("passing");
	});

	it("fails before it pends before it passes, and a waiting check is pending", () => {
		expect(summarizeChecks([check("success"), check("waiting")]).status).toBe("pending");
		expect(summarizeChecks([check("success"), check("running"), check("failure")]).status).toBe(
			"failing",
		);
		expect(summarizeChecks([check("success")]).status).toBe("passing");
	});

	it("keeps a waiting check and a waiting status context waiting", () => {
		expect(
			checkStateOfRun({
				name: "build",
				status: "WAITING",
				conclusion: null,
				detailsUrl: null,
				startedAt: null,
				completedAt: null,
			}),
		).toBe("waiting");
		expect(checkStateOfContext({ context: "deploy", state: "EXPECTED", targetUrl: null })).toBe(
			"waiting",
		);
	});
});

describe("PR-03 reviewers", () => {
	it("lists requested people as awaiting and latest reviews with their state", () => {
		expect(toReviewers(rawFromGraphql(node))).toEqual([
			{ login: "hubot", avatarUrl: "h", state: "approved" },
			{ login: "mona", avatarUrl: null, state: "changes_requested" },
		]);
	});

	it("leaves teams out of the person list", () => {
		const reviewers = toReviewers({
			reviewRequests: [{ requestedReviewer: { slug: "platform" } }],
			latestReviews: [],
		});
		expect(reviewers).toEqual([]);
	});

	it("maps every review state the Checks tab shows", () => {
		expect(reviewerStateOf("APPROVED")).toBe("approved");
		expect(reviewerStateOf("CHANGES_REQUESTED")).toBe("changes_requested");
		expect(reviewerStateOf("COMMENTED")).toBe("commented");
		expect(reviewerStateOf("DISMISSED")).toBe("dismissed");
		expect(reviewerStateOf("PENDING")).toBe("awaiting");
		expect(reviewerStateOf("REQUESTED")).toBe("awaiting");
	});
});

describe("PR-03 deployments", () => {
	it("names a known provider from the deployment URL", () => {
		expect(deploymentProviderOf("Production", "https://shop.vercel.app")).toBe("vercel");
		expect(deploymentProviderOf("Web", "https://o.pages.dev")).toBe("cloudflare");
		expect(deploymentProviderOf("Preview", "https://o.netlify.app")).toBe("netlify");
		expect(deploymentProviderOf("Docs", "https://o.github.io")).toBe("github_pages");
		expect(deploymentProviderOf("Unknown", "https://example.test")).toBe("other");
	});

	it("maps each GitHub deployment state", () => {
		expect(deploymentStateOf("SUCCESS")).toBe("deployed");
		expect(deploymentStateOf("FAILURE")).toBe("failed");
		expect(deploymentStateOf("IN_PROGRESS")).toBe("deploying");
		expect(deploymentStateOf("PENDING")).toBe("pending");
		expect(deploymentStateOf("INACTIVE")).toBe("inactive");
	});

	it("sorts deployments newest first and drops one with no readable time", () => {
		const deployments = toDeployments([
			{
				environment: "Staging",
				updatedAt: "2026-01-01T00:00:00Z",
				latestStatus: {
					state: "FAILURE",
					environmentUrl: null,
					updatedAt: "2026-01-01T00:00:00Z",
				},
			},
			{
				environment: "Production",
				updatedAt: "2026-01-03T00:00:00Z",
				latestStatus: {
					state: "SUCCESS",
					environmentUrl: null,
					updatedAt: "2026-01-03T00:00:00Z",
				},
			},
			{ environment: "Broken", updatedAt: "not a date", latestStatus: null },
		]);
		expect(deployments.map((deployment) => deployment.environment)).toEqual([
			"Production",
			"Staging",
		]);
		expect(deployments[1]?.state).toBe("failed");
	});
});

describe("PR-03 pull request rules", () => {
	it("lifts the fields the poll needs out of the GraphQL node", () => {
		const raw = rawFromGraphql(node);
		expect(raw).toMatchObject({
			author: { login: "octocat" },
			baseRefOid: "base-1",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-02T00:00:00Z",
			headRefName: "feature/as-pushed",
		});
		expect(raw.reviewRequests).toHaveLength(2);
		expect(raw.latestReviews).toHaveLength(2);
		expect(raw.deployments).toHaveLength(1);
	});

	it("keeps a known merge state when GitHub answers UNKNOWN for the same head", () => {
		expect(reconcileMergeable("mergeable", "unknown", true)).toBe("mergeable");
		expect(reconcileMergeable("conflicting", "unknown", true)).toBe("conflicting");
		expect(reconcileMergeable("mergeable", "unknown", false)).toBe("unknown");
		expect(reconcileMergeable(null, "unknown", true)).toBe("unknown");
		expect(reconcileMergeable("mergeable", "conflicting", true)).toBe("conflicting");
	});

	it("shows a closed PR only while the local branch still matches its head", () => {
		expect(closedPrIsShown("closed", "feature", "feature")).toBe(true);
		expect(closedPrIsShown("closed", "renamed", "feature")).toBe(false);
		expect(closedPrIsShown("closed", "feature", null)).toBe(false);
		expect(closedPrIsShown("open", "renamed", "feature")).toBe(true);
		expect(closedPrIsShown("merged", "renamed", "feature")).toBe(true);
	});

	it("takes the head branch from the configured upstream, as pushed", () => {
		expect(headBranchFromUpstream("origin", "refs/heads/feature/as-pushed")).toBe(
			"feature/as-pushed",
		);
		expect(headBranchFromUpstream("", "refs/heads/feature")).toBeNull();
		expect(headBranchFromUpstream("origin", "refs/tags/v1")).toBeNull();
		expect(headBranchFromUpstream("origin", null)).toBeNull();
	});
});
