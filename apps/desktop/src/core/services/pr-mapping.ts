/**
 * @feature PR-03 Mapping GitHub's answer to our pull request model
 * Owns: turning the raw GraphQL nodes that `gh api graphql` returns (see PR_FIELDS_FRAGMENT in
 * git/gh-commands.ts) into `PullRequest` and `CheckRun` values, and summarising checks.
 * Behaviour: services-map.md 3.7.2 (derived state: checks passing, pending, failing; duplicate
 * check runs; the newest wins), 5B.1.4 (fields and derived checks status), ui-map.md 3.6
 * (header states that depend on these values).
 * Must handle: a node with missing optional fields (null `mergeable`, no check rollup, no
 * review decision); duplicate check runs with the same workflow and name (keep the newest by
 * `completedAt`, else `startedAt`); a closed, unmerged PR maps to "closed"; a draft maps to
 * "draft" only while open; check conclusions the app does not know map
 * to "failure" for ACTION_REQUIRED, TIMED_OUT and STARTUP_FAILURE, to "skipped" for NEUTRAL,
 * STALE and SKIPPED.
 * Not here: keeping a known merge state when GitHub answers UNKNOWN for the same head commit. That
 * belongs to the poller (PR-03), which has the previous value.
 * Our design choice: the raw types below are the subset of fields we ask for, written from
 * GitHub's public schema. They are not shared with the query text, so the test pins both.
 * Test first: a rollup with two runs named "build" keeps only the newest one.
 */
import type { CheckRun, CheckState, PullRequest } from "../model.ts";

export interface RawCheckRunNode {
	__typename?: "CheckRun";
	name: string;
	status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "WAITING" | "PENDING" | "REQUESTED";
	conclusion:
		| "SUCCESS"
		| "FAILURE"
		| "NEUTRAL"
		| "CANCELLED"
		| "SKIPPED"
		| "TIMED_OUT"
		| "ACTION_REQUIRED"
		| "STALE"
		| "STARTUP_FAILURE"
		| null;
	detailsUrl: string | null;
	startedAt: string | null;
	completedAt: string | null;
	/** Name of the workflow, when GitHub says. Used to tell same-named jobs of two workflows apart. */
	workflowName?: string | null;
}

export interface RawStatusContextNode {
	__typename?: "StatusContext";
	context: string;
	state: "EXPECTED" | "ERROR" | "FAILURE" | "PENDING" | "SUCCESS";
	targetUrl: string | null;
}

export type RawCheckNode = RawCheckRunNode | RawStatusContextNode;

export interface RawPullRequest {
	number: number;
	url: string;
	title: string;
	body: string | null;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
	mergeStateStatus: string | null;
	reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	baseRefName: string;
	headRefOid: string;
	/** The signed-in user opened this pull request. */
	viewerDidAuthor: boolean;
	autoMergeRequest: { enabledAt: string } | null;
	mergeQueueEntry: { state: string; position: number } | null;
	checks: readonly RawCheckNode[];
}

/**
 * The pull request fields the per-PR query does not carry. The caller learns them elsewhere (the
 * repository's merge settings and the viewer's permission, the review and deployment queries,
 * the author) and passes them in, so the mapper stays a pure function of its inputs.
 */
export type PullRequestExtras = Pick<
	PullRequest,
	"authorLogin" | "viewerCanMerge" | "mergeMethod" | "reviewers" | "deployments" | "updatedAt"
>;

const isCheckRun = (node: RawCheckNode): node is RawCheckRunNode => "status" in node;

const parseTime = (value: string | null): number | null => {
	if (value === null) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
};

export function checkStateOfRun(node: RawCheckRunNode): CheckState {
	if (node.status !== "COMPLETED") return node.status === "IN_PROGRESS" ? "running" : "pending";
	switch (node.conclusion) {
		case "SUCCESS":
			return "success";
		case "CANCELLED":
			return "cancelled";
		case "NEUTRAL":
		case "STALE":
		case "SKIPPED":
			return "skipped";
		case "FAILURE":
		case "TIMED_OUT":
		case "ACTION_REQUIRED":
		case "STARTUP_FAILURE":
			return "failure";
		case null:
			return "pending";
	}
}

export function checkStateOfContext(node: RawStatusContextNode): CheckState {
	switch (node.state) {
		case "SUCCESS":
			return "success";
		case "PENDING":
		case "EXPECTED":
			return "pending";
		case "ERROR":
		case "FAILURE":
			return "failure";
	}
}

/**
 * Converts the rollup to check runs and drops older duplicates of the same workflow and name.
 * `requiredNames` are the check names the repository's branch protection requires.
 */
export function toCheckRuns(
	nodes: readonly RawCheckNode[],
	requiredNames: ReadonlySet<string>,
): CheckRun[] {
	const newest = new Map<string, { run: CheckRun; at: number }>();
	for (const node of nodes) {
		const run: CheckRun = isCheckRun(node)
			? {
					name: node.name,
					state: checkStateOfRun(node),
					url: node.detailsUrl,
					startedAt: parseTime(node.startedAt),
					completedAt: parseTime(node.completedAt),
					required: requiredNames.has(node.name),
				}
			: {
					name: node.context,
					state: checkStateOfContext(node),
					url: node.targetUrl,
					startedAt: null,
					completedAt: null,
					required: requiredNames.has(node.context),
				};
		const key = isCheckRun(node)
			? `check-run:${node.workflowName ?? ""}:${node.name}`
			: `status-context:${node.context}`;
		const at = run.completedAt ?? run.startedAt ?? 0;
		const existing = newest.get(key);
		if (existing === undefined || at >= existing.at) newest.set(key, { run, at });
	}
	return [...newest.values()].map((entry) => entry.run);
}

export interface ChecksSummary {
	total: number;
	failed: number;
	pending: number;
	/** "passing" when nothing failed or is pending. */
	status: "passing" | "pending" | "failing";
}

export function summarizeChecks(checks: readonly CheckRun[]): ChecksSummary {
	const failed = checks.filter((c) => c.state === "failure").length;
	const pending = checks.filter((c) => c.state === "pending" || c.state === "running").length;
	return {
		total: checks.length,
		failed,
		pending,
		status: failed > 0 ? "failing" : pending > 0 ? "pending" : "passing",
	};
}

/** The pull request node as `gh api graphql` returns it for PR_FIELDS_FRAGMENT. */
export interface GraphqlPullRequestNode {
	number: number;
	url: string;
	title: string;
	body: string | null;
	state: RawPullRequest["state"];
	isDraft: boolean;
	mergeable: RawPullRequest["mergeable"];
	mergeStateStatus: string | null;
	reviewDecision: RawPullRequest["reviewDecision"];
	baseRefName: string;
	headRefOid: string;
	viewerDidAuthor: boolean;
	autoMergeRequest: { enabledAt: string } | null;
	mergeQueueEntry: { state: string; position: number } | null;
	headRef: {
		target: {
			statusCheckRollup: {
				contexts: {
					nodes: readonly (
						| (Omit<RawCheckRunNode, "workflowName"> & {
								checkSuite?: {
									workflowRun?: { workflow?: { name?: string | null } | null } | null;
								} | null;
						  })
						| RawStatusContextNode
					)[];
				};
			} | null;
		} | null;
	} | null;
}

/** Flattens the nested check rollup of one GraphQL node into `RawPullRequest`. */
export function rawFromGraphql(node: GraphqlPullRequestNode): RawPullRequest {
	const nodes = node.headRef?.target?.statusCheckRollup?.contexts.nodes ?? [];
	const checks: RawCheckNode[] = nodes.map((entry) => {
		if (!("status" in entry)) return entry;
		const { checkSuite, ...run } = entry;
		return { ...run, workflowName: checkSuite?.workflowRun?.workflow?.name ?? null };
	});
	return {
		number: node.number,
		url: node.url,
		title: node.title,
		body: node.body,
		state: node.state,
		isDraft: node.isDraft,
		mergeable: node.mergeable,
		mergeStateStatus: node.mergeStateStatus,
		reviewDecision: node.reviewDecision,
		baseRefName: node.baseRefName,
		headRefOid: node.headRefOid,
		viewerDidAuthor: node.viewerDidAuthor,
		autoMergeRequest: node.autoMergeRequest,
		mergeQueueEntry: node.mergeQueueEntry,
		checks,
	};
}

export function toPullRequest(
	raw: RawPullRequest,
	extras: PullRequestExtras,
	requiredCheckNames: ReadonlySet<string>,
): PullRequest {
	const state: PullRequest["state"] =
		raw.state === "MERGED"
			? "merged"
			: raw.state === "CLOSED"
				? "closed"
				: raw.isDraft
					? "draft"
					: "open";
	return {
		number: raw.number,
		url: raw.url,
		title: raw.title,
		body: raw.body ?? "",
		state,
		mergeable:
			raw.mergeable === "MERGEABLE"
				? "mergeable"
				: raw.mergeable === "CONFLICTING"
					? "conflicting"
					: "unknown",
		reviewDecision:
			raw.reviewDecision === "APPROVED"
				? "approved"
				: raw.reviewDecision === "CHANGES_REQUESTED"
					? "changes_requested"
					: raw.reviewDecision === "REVIEW_REQUIRED"
						? "review_required"
						: null,
		checks: toCheckRuns(raw.checks, requiredCheckNames),
		inMergeQueue: raw.mergeQueueEntry !== null,
		autoMergeEnabled: raw.autoMergeRequest !== null,
		baseBranch: raw.baseRefName,
		viewerDidAuthor: raw.viewerDidAuthor,
		...extras,
	};
}
