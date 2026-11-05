/**
 * @feature PR-03 Mapping GitHub's answer to our pull request model
 * Owns: turning the raw GraphQL nodes that `gh api graphql` returns (see PR_FIELDS_FRAGMENT in
 * git/gh-commands.ts) into `PullRequest`, `CheckRun`, reviewer and deployment values, and
 * summarising checks.
 * Behaviour: services-map.md 3.7.2 (derived state: checks passing, pending, failing; duplicate
 * check runs; the newest wins; CLEAN forces passing; a closed unmerged PR shows only while the
 * branch matches its head; the head branch comes from the upstream config), 5B.1.4 (fields and
 * derived checks status), ui-map.md 3.6 (checks, reviewer and deployment states).
 * Must handle: a node with missing optional fields (null `mergeable`, no check rollup, no
 * review decision); duplicate check runs with the same workflow and name (keep the newest by
 * `completedAt`, else `startedAt`); a closed, unmerged PR maps to "closed"; a draft maps to
 * "draft" only while open; check conclusions the app does not know map
 * to "failure" for ACTION_REQUIRED, TIMED_OUT and STARTUP_FAILURE, to "skipped" for NEUTRAL,
 * STALE and SKIPPED; a WAITING check stays waiting; a requested reviewer has no state yet.
 * A known merge state is kept when GitHub answers UNKNOWN for the same head commit:
 * `reconcileMergeable` is the rule; the poller supplies the previous value and head commit.
 * Our design choice: the raw types below are the subset of fields we ask for, written from
 * GitHub's public schema. They are not shared with the query text, so the test pins both.
 * Test first: a rollup with two runs named "build" keeps only the newest one.
 */
import type {
	CheckRun,
	CheckState,
	DeploymentProvider,
	DeploymentState,
	DeploymentView,
	PullRequest,
	ReviewerState,
	ReviewerView,
} from "../model.ts";

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

export interface RawAuthor {
	login: string;
	avatarUrl?: string | null;
}

export interface RawRequestedReviewerNode {
	requestedReviewer: RawAuthor | { slug: string; avatarUrl?: string | null } | null;
}

export type RawReviewState =
	| "APPROVED"
	| "CHANGES_REQUESTED"
	| "COMMENTED"
	| "DISMISSED"
	| "PENDING"
	| "REQUESTED";

export interface RawReviewNode {
	author?: RawAuthor | null;
	state: RawReviewState;
	submittedAt?: string | null;
}

/** The signed-in user's latest review of the pull request, with the commit it was made on. */
export interface RawViewerLatestReview {
	state: RawReviewState;
	commit: { oid: string } | null;
}

export interface RawDeploymentStatusNode {
	state: string;
	environmentUrl: string | null;
	updatedAt: string;
}

export interface RawDeploymentNode {
	environment: string;
	updatedAt: string;
	latestStatus: RawDeploymentStatusNode | null;
}

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
	/** The head branch as pushed, when the query asked for it. */
	headRefName?: string | null;
	author?: RawAuthor | null;
	baseRefOid?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
	reviewRequests?: readonly RawRequestedReviewerNode[] | null;
	latestReviews?: readonly RawReviewNode[] | null;
	viewerLatestReview?: RawViewerLatestReview | null;
	deployments?: readonly RawDeploymentNode[] | null;
	/** The signed-in user opened this pull request. */
	viewerDidAuthor: boolean;
	autoMergeRequest: { enabledAt: string } | null;
	mergeQueueEntry: { state: string; position: number } | null;
	checks: readonly RawCheckNode[];
}

/**
 * The pull request fields the mapper does not derive itself: the viewer's permission and the
 * repository's merge method from the same repository answer, and the author, reviewers,
 * deployments and update time lifted from the pull request node. The poller passes them in, so
 * the mapper stays a pure function of its inputs.
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
	if (node.status === "WAITING") return "waiting";
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
		case "EXPECTED":
			return "waiting";
		case "PENDING":
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

/**
 * Summarises the checks. A CLEAN merge state forces "passing" (services-map 3.7.2): GitHub has
 * already decided that the required checks are satisfied, whatever individual runs still report.
 */
export function summarizeChecks(
	checks: readonly CheckRun[],
	mergeStateStatus: string | null = null,
): ChecksSummary {
	const failed = checks.filter((c) => c.state === "failure").length;
	const pending = checks.filter(
		(c) => c.state === "pending" || c.state === "waiting" || c.state === "running",
	).length;
	return {
		total: checks.length,
		failed,
		pending,
		status:
			mergeStateStatus === "CLEAN"
				? "passing"
				: failed > 0
					? "failing"
					: pending > 0
						? "pending"
						: "passing",
	};
}

/** The reviewer state a GitHub review state means (ui-map 3.6). */
export function reviewerStateOf(state: RawReviewState): ReviewerState {
	switch (state) {
		case "APPROVED":
			return "approved";
		case "CHANGES_REQUESTED":
			return "changes_requested";
		case "DISMISSED":
			return "dismissed";
		case "COMMENTED":
			return "commented";
		case "PENDING":
		case "REQUESTED":
			return "awaiting";
	}
}

const hasLogin = (value: RawAuthor | { slug: string } | null): value is RawAuthor =>
	value !== null && "login" in value;

/**
 * Reviewers from the review requests and the latest review of each person. A requested reviewer
 * who has not reviewed yet is awaiting. Teams carry a slug rather than a login and are left out of
 * the person list.
 */
export function toReviewers(
	node: Pick<RawPullRequest, "reviewRequests" | "latestReviews">,
): ReviewerView[] {
	const byLogin = new Map<string, ReviewerView>();
	for (const request of node.reviewRequests ?? []) {
		const reviewer = request.requestedReviewer;
		if (!hasLogin(reviewer)) continue;
		byLogin.set(reviewer.login, {
			login: reviewer.login,
			avatarUrl: reviewer.avatarUrl ?? null,
			state: "awaiting",
		});
	}
	for (const review of node.latestReviews ?? []) {
		if (review.author === null || review.author === undefined) continue;
		byLogin.set(review.author.login, {
			login: review.author.login,
			avatarUrl: review.author.avatarUrl ?? null,
			state: reviewerStateOf(review.state),
		});
	}
	return [...byLogin.values()];
}

const DEPLOYMENT_PROVIDERS: readonly [DeploymentProvider, RegExp][] = [
	["vercel", /vercel/],
	["cloudflare", /cloudflare|pages\.dev|workers\.dev/],
	["netlify", /netlify/],
	["render", /onrender\.com|\brender\b/],
	["railway", /railway/],
	["fly", /fly\.(dev|io)|fly\.io/],
	["amplify", /amplifyapp\.com|amplify/],
	["heroku", /heroku/],
	["github_pages", /github\.io|pages\.github\.com/],
];

/** The deployment state a GitHub status means (ui-map 3.6). */
export function deploymentStateOf(state: string): DeploymentState {
	switch (state.toUpperCase()) {
		case "SUCCESS":
			return "deployed";
		case "FAILURE":
		case "ERROR":
			return "failed";
		case "IN_PROGRESS":
		case "QUEUED":
			return "deploying";
		case "INACTIVE":
			return "inactive";
		case "PENDING":
		case "WAITING":
			return "pending";
		default:
			return "pending";
	}
}

/** The provider a deployment belongs to, from its environment name or its URL. */
export function deploymentProviderOf(environment: string, url: string | null): DeploymentProvider {
	const text = `${environment} ${url ?? ""}`.toLowerCase();
	for (const [provider, pattern] of DEPLOYMENT_PROVIDERS) {
		if (pattern.test(text)) return provider;
	}
	return "other";
}

/** Deployments newest first, dropping any node whose update time GitHub did not give. */
export function toDeployments(nodes: readonly RawDeploymentNode[]): DeploymentView[] {
	const deployments: DeploymentView[] = [];
	for (const node of nodes) {
		const status = node.latestStatus;
		const updatedAt = parseTime(status?.updatedAt ?? node.updatedAt);
		if (updatedAt === null) continue;
		const url = status?.environmentUrl ?? null;
		deployments.push({
			environment: node.environment,
			provider: deploymentProviderOf(node.environment, url),
			state: deploymentStateOf(status?.state ?? ""),
			url,
			updatedAt,
		});
	}
	return deployments.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Keeps a known merge state when GitHub answers UNKNOWN for the same head commit. GitHub computes
 * mergeability after a push, so an UNKNOWN answer must not replace what the user already sees.
 */
export function reconcileMergeable(
	previous: PullRequest["mergeable"] | null,
	next: PullRequest["mergeable"],
	sameHead: boolean,
): PullRequest["mergeable"] {
	return next === "unknown" && previous !== null && sameHead ? previous : next;
}

/**
 * A closed, unmerged PR is shown only while the local branch still matches its head
 * (services-map 3.7.2).
 */
export function closedPrIsShown(
	state: PullRequest["state"],
	localBranch: string,
	prHeadBranch: string | null,
): boolean {
	return state !== "closed" || (prHeadBranch !== null && localBranch === prHeadBranch);
}

/**
 * Our state for a pull request, from GitHub's state and draft flag. Draft only applies while the
 * PR is open, so a merged or closed draft is reported as merged or closed. This is the one place
 * the mapping lives: the GraphQL poll, the REST read and the model mapper all call it.
 */
export function pullRequestStateOf(
	state: string | null | undefined,
	isDraft: boolean,
): PullRequest["state"] {
	switch (state?.toUpperCase()) {
		case "MERGED":
			return "merged";
		case "OPEN":
			return isDraft ? "draft" : "open";
		default:
			return "closed";
	}
}

/**
 * The branch as pushed, from `branch.<local>.remote` and `branch.<local>.merge`
 * (services-map 3.7.2). Returns null when the upstream is unset or not a local branch.
 */
export function headBranchFromUpstream(remote: string | null, merge: string | null): string | null {
	if (remote === null || remote.trim().length === 0 || merge === null) return null;
	const prefix = "refs/heads/";
	if (!merge.startsWith(prefix)) return null;
	const branch = merge.slice(prefix.length);
	return branch.length > 0 ? branch : null;
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
	headRefName?: string | null;
	headRefOid: string;
	author?: RawAuthor | null;
	baseRef?: { target?: { oid?: string | null } | null } | null;
	createdAt?: string | null;
	updatedAt?: string | null;
	viewerDidAuthor: boolean;
	reviewRequests?: { nodes?: readonly RawRequestedReviewerNode[] | null } | null;
	latestReviews?: { nodes?: readonly RawReviewNode[] | null } | null;
	viewerLatestReview?: RawViewerLatestReview | null;
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
			deployments?: { nodes?: readonly RawDeploymentNode[] | null } | null;
		} | null;
	} | null;
}

/** Flattens the nested check rollup and deployments of one GraphQL node into `RawPullRequest`. */
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
		headRefName: node.headRefName ?? null,
		author: node.author ?? null,
		baseRefOid: node.baseRef?.target?.oid ?? null,
		createdAt: node.createdAt ?? null,
		updatedAt: node.updatedAt ?? null,
		reviewRequests: node.reviewRequests?.nodes ?? [],
		latestReviews: node.latestReviews?.nodes ?? [],
		viewerLatestReview: node.viewerLatestReview ?? null,
		deployments: node.headRef?.target?.deployments?.nodes ?? [],
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
	const state = pullRequestStateOf(raw.state, raw.isDraft);
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
