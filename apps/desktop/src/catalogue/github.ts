/**
 * @feature catalogue Scripted GitHub answers for catalogue workspaces
 * Owns: answering `gh` the way GitHub would for a signed-in user: the sign-in check, the user's login,
 * the batched pull request query (one pull request per head branch, or none, in any of the states
 * the header tells apart), the review threads a pull request's reviewers left, and empty general
 * comments, the GitHub stacks pull requests belong to (the stack entry, its members and each
 * member's merge state); or failing every API request as `gh` does when this Mac is offline or
 * GitHub refuses the sign-in.
 * Behaviour: core/git/gh-commands.ts builds the commands; core/services/github.ts reads the answers
 * (parsePrBatchAnswers and the GraphQL node fields in PR_FIELDS_FRAGMENT; parsePrStackEntry,
 * parseStackMembers and parseStackReadiness for a stack, services-map.md 3.8.2).
 * Test first: not applicable; the screenshot run opens every state that uses it.
 */
import { ok, type Result } from "@conducted/shared";
import type { ShellScript } from "../platform/memory.ts";
import type { ShellOutput } from "../platform/platform.ts";

const out = (stdout: string, exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr: "", exitCode });

export type PrKind =
	| "open"
	| "draft"
	| "ready"
	| "merged"
	| "failing"
	/** A reviewer asked for changes; the checks passed. */
	| "changes_requested"
	/** GitHub found a conflict with the base branch. */
	| "conflicting"
	/** Approved and waiting in the merge queue. */
	| "queued"
	/** Closed without merging. */
	| "closed"
	/** Approved, the checks passed, and GitHub has not said yet whether it can merge. */
	| "blocked"
	/** Approved, no check has reported yet, and GitHub is still working out mergeability. */
	| "checking";

export interface ScriptedPr {
	kind: PrKind;
	number: number;
	title: string;
	branch: string;
	base: string;
	/** When the pull request was opened, in milliseconds since the epoch. */
	createdAt: number;
	/** Review comments on the diff, one thread each. */
	reviewComments?: ScriptedReviewComment[];
	/** The head commit's checks, in place of the ones the kind implies. */
	checks?: ScriptedCheck[];
	/** The head commit's deployments, newest first. */
	deployments?: ScriptedDeployment[];
	/** The description, when not the login fix's own. */
	body?: string;
	/** Each reviewer's latest review, in place of the ones the kind implies. */
	reviews?: {
		login: string;
		state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
	}[];
	/** Reviewers asked for a review who have not given one. */
	requestedReviewers?: string[];
	/** Auto-merge is on: GitHub merges once the checks pass. */
	autoMerge?: boolean;
}

/** A check on the head commit: a workflow job, or an outside service's status. */
export type ScriptedCheck =
	| {
			kind: "run";
			name: string;
			workflow: string;
			/** GitHub's run status and conclusion, as its GraphQL names them. */
			status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "WAITING";
			conclusion: "SUCCESS" | "FAILURE" | "CANCELLED" | "SKIPPED" | null;
			minutes: number;
	  }
	| { kind: "status"; context: string; state: "SUCCESS" | "PENDING" | "FAILURE"; url: string };

export interface ScriptedDeployment {
	environment: string;
	/** GitHub's deployment status: SUCCESS, FAILURE, IN_PROGRESS, PENDING or INACTIVE. */
	state: string;
	url: string;
	/** Milliseconds since the epoch. */
	at: number;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function checkNode(
	check: ScriptedCheck,
	startedAt: number,
	index: number,
): Record<string, unknown> {
	if (check.kind === "status") {
		return { context: check.context, state: check.state, targetUrl: check.url };
	}
	return {
		name: check.name,
		status: check.status,
		conclusion: check.conclusion,
		detailsUrl: `https://github.com/acme/atlas/actions/runs/1029384756/job/${5_000 + index}`,
		startedAt: check.status === "QUEUED" || check.status === "WAITING" ? null : iso(startedAt),
		completedAt: check.status === "COMPLETED" ? iso(startedAt + check.minutes * 60_000) : null,
		checkSuite: { workflowRun: { workflow: { name: check.workflow } } },
	};
}

function deploymentNode(deployment: ScriptedDeployment): Record<string, unknown> {
	return {
		environment: deployment.environment,
		createdAt: iso(deployment.at),
		updatedAt: iso(deployment.at),
		latestStatus: {
			state: deployment.state,
			environmentUrl: deployment.url,
			createdAt: iso(deployment.at),
			updatedAt: iso(deployment.at),
		},
	};
}

export interface ScriptedReviewComment {
	path: string;
	line: number;
	body: string;
	author: string;
	/** Milliseconds since the epoch. */
	at: number;
}

/** The `reviewThreads` nodes GitHub returns for these comments. */
function reviewThreadNodes(comments: readonly ScriptedReviewComment[]): unknown[] {
	return comments.map((comment, index) => ({
		id: `PRRT_${index + 1}`,
		isOutdated: false,
		isResolved: false,
		path: comment.path,
		line: comment.line,
		startLine: null,
		originalLine: comment.line,
		originalStartLine: null,
		startDiffSide: null,
		diffSide: "RIGHT",
		comments: {
			pageInfo: { hasNextPage: false, endCursor: null },
			nodes: [
				{
					id: `PRRC_${index + 1}`,
					databaseId: 9_000 + index,
					body: comment.body,
					diffHunk: null,
					url: null,
					createdAt: iso(comment.at),
					updatedAt: iso(comment.at),
					lastEditedAt: null,
					author: { login: comment.author, avatarUrl: "" },
					replyTo: null,
				},
			],
		},
	}));
}

/** A check run on the pull request's head commit. */
const checkRun = (
	name: string,
	workflow: string,
	conclusion: string | null,
	startedAt: number,
	minutes: number,
) => ({
	name,
	status: conclusion === null ? "IN_PROGRESS" : "COMPLETED",
	conclusion,
	detailsUrl: `https://github.com/acme/atlas/actions/runs/1029384756/job/${name.length}`,
	startedAt: iso(startedAt),
	completedAt: conclusion === null ? null : iso(startedAt + minutes * 60_000),
	checkSuite: { workflowRun: { workflow: { name: workflow } } },
});

/** The GraphQL node GitHub returns for a pull request in the given state. */
function pullRequestNode(pr: ScriptedPr): Record<string, unknown> {
	const merged = pr.kind === "merged";
	const closed = pr.kind === "closed";
	const at = pr.createdAt;
	const approved =
		pr.kind === "ready" ||
		merged ||
		pr.kind === "queued" ||
		pr.kind === "blocked" ||
		pr.kind === "checking";
	const checks =
		pr.kind === "checking"
			? []
			: pr.kind === "open"
				? [
						checkRun("lint", "CI", "SUCCESS", at, 1),
						checkRun("typecheck", "CI", "SUCCESS", at, 2),
						checkRun("test", "CI", null, at, 0),
					]
				: pr.kind === "failing"
					? [
							checkRun("lint", "CI", "SUCCESS", at, 1),
							checkRun("typecheck", "CI", "SUCCESS", at, 2),
							checkRun("test", "CI", "FAILURE", at, 4),
						]
					: [
							checkRun("lint", "CI", "SUCCESS", at, 1),
							checkRun("typecheck", "CI", "SUCCESS", at, 2),
							checkRun("test", "CI", "SUCCESS", at, 4),
						];
	return {
		number: pr.number,
		url: `https://github.com/acme/atlas/pull/${pr.number}`,
		title: pr.title,
		body:
			pr.body ??
			"Keeps the page a user asked for when they sign in.\n\n- Reads `next` from the sign-in URL\n- Accepts paths on this site only",
		state: merged ? "MERGED" : closed ? "CLOSED" : "OPEN",
		isDraft: pr.kind === "draft",
		mergedAt: merged ? iso(at + 3 * 3_600_000) : null,
		mergeable:
			merged || pr.kind === "blocked" || pr.kind === "checking"
				? "UNKNOWN"
				: pr.kind === "conflicting"
					? "CONFLICTING"
					: "MERGEABLE",
		mergeStateStatus:
			pr.kind === "ready" || pr.kind === "queued"
				? "CLEAN"
				: pr.kind === "conflicting"
					? "DIRTY"
					: merged || pr.kind === "checking"
						? "UNKNOWN"
						: "BLOCKED",
		reviewDecision: approved
			? "APPROVED"
			: pr.kind === "changes_requested"
				? "CHANGES_REQUESTED"
				: "REVIEW_REQUIRED",
		baseRefName: pr.base,
		baseRef: { target: { oid: "8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d" } },
		headRefName: pr.branch,
		headRefOid: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
		createdAt: iso(at),
		updatedAt: iso(at + 3_600_000),
		author: { login: "sam", avatarUrl: "" },
		viewerDidAuthor: true,
		viewerLatestReview: null,
		reviewRequests: {
			nodes: (pr.requestedReviewers ?? []).map((login) => ({
				requestedReviewer: { login, avatarUrl: "" },
			})),
		},
		latestReviews: {
			nodes:
				pr.reviews !== undefined
					? pr.reviews.map((review, index) => ({
							author: { login: review.login, avatarUrl: "" },
							state: review.state,
							submittedAt: iso(at + (index + 1) * 3_600_000),
						}))
					: approved || pr.kind === "changes_requested"
						? [
								{
									author: { login: "lee", avatarUrl: "" },
									state: approved ? "APPROVED" : "CHANGES_REQUESTED",
									submittedAt: iso(at + 7_200_000),
								},
							]
						: [],
		},
		autoMergeRequest: pr.autoMerge === true ? { enabledAt: iso(at + 3_600_000) } : null,
		mergeQueueEntry: pr.kind === "queued" ? { state: "QUEUED", position: 2 } : null,
		headRef: merged
			? null
			: {
					target: {
						statusCheckRollup: {
							contexts: {
								nodes:
									pr.checks === undefined
										? checks
										: pr.checks.map((check, index) => checkNode(check, at, index)),
							},
						},
						deployments: { nodes: (pr.deployments ?? []).map(deploymentNode) },
					},
				},
	};
}

/** One pull request of a GitHub stack, as the stack's members endpoint lists it. */
export interface ScriptedStackMember {
	number: number;
	title: string;
	branch: string;
	state: "open" | "draft" | "merged" | "closed";
	/** The member's head commit, and the commit its base branch pointed at. */
	headSha: string;
	baseSha: string;
	/** The branch the member merges into. */
	base: string;
	/** GitHub's `mergeStateStatus` for the member: CLEAN, BLOCKED, DIRTY, BEHIND or UNKNOWN. */
	mergeState: string;
}

/** A GitHub stack: its number, the trunk it sits on and its members from trunk up. */
export interface ScriptedStack {
	number: number;
	baseRefName: string;
	members: ScriptedStackMember[];
}

/** The members endpoint's entry for one member. */
function stackMemberNode(member: ScriptedStackMember): Record<string, unknown> {
	return {
		number: member.number,
		title: member.title,
		state: member.state === "merged" || member.state === "closed" ? "closed" : "open",
		draft: member.state === "draft",
		merged_at: member.state === "merged" ? "2026-11-05T10:00:00Z" : null,
		head: { ref: member.branch, sha: member.headSha },
		base: { ref: member.base, sha: member.baseSha },
	};
}

/**
 * Why GitHub cannot be read: this Mac is offline, or GitHub refuses the stored sign-in. Each is
 * the output the real `gh` prints for that failure.
 */
export type GitHubFailure = "offline" | "unauthorized";

const FAILURE_OUTPUT: Record<GitHubFailure, string> = {
	offline: 'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n',
	unauthorized: "HTTP 401: Bad credentials (https://api.github.com/graphql)\n",
};

/** An open issue of the repository, as GitHub's REST answer lists it. */
export interface ScriptedIssue {
	number: number;
	title: string;
	/** Milliseconds since the epoch. */
	updatedAt: number;
}

export interface ScriptedGitHub {
	/** Pull requests, keyed by head branch. */
	prs?: readonly ScriptedPr[];
	/** Every request to GitHub's API fails this way. */
	failure?: GitHubFailure;
	stacks?: readonly ScriptedStack[];
	/** The repository's open issues, newest first. */
	issues?: readonly ScriptedIssue[];
	/** The merge methods the repository allows; all three unless given. */
	mergeMethods?: { squash: boolean; rebase: boolean; merge: boolean };
}

/**
 * Answers `gh` for a signed-in user whose pull requests, stacks and issues are the given ones.
 * With a `failure`, every request to GitHub's API fails the way `gh` reports it.
 */
export function scriptGitHub({
	prs = [],
	failure,
	stacks = [],
	issues = [],
	mergeMethods = { squash: true, rebase: true, merge: true },
}: ScriptedGitHub = {}): ShellScript {
	return (command) => {
		if (command.program !== "gh") return null;
		const args = command.args;
		const joined = args.join(" ");
		if (failure !== undefined && args[0] === "api") {
			return ok({ stdout: "", stderr: FAILURE_OUTPUT[failure], exitCode: 1 });
		}
		if (joined === "auth status")
			return out("github.com\n  ✓ Logged in to github.com account sam\n");
		if (joined.startsWith("api user")) return out("sam\n");
		if (joined === "config get git_protocol") return out("ssh\n");
		if (joined === "api rate_limit") {
			const graphql = { limit: 5_000, used: 10, remaining: 4_990, reset: 1_793_966_400 };
			return out(JSON.stringify({ resources: { graphql, core: graphql }, rate: graphql }));
		}
		if (args[0] === "api" && args[1] === "graphql") {
			const query = args.find((arg) => arg.startsWith("query=")) ?? "";
			// The stack a pull request belongs to: null outside every stack.
			if (query.includes("stackEntry")) {
				const number = Number(args.find((arg) => arg.startsWith("prNumber="))?.slice(9));
				const stack = stacks.find((candidate) =>
					candidate.members.some((member) => member.number === number),
				);
				const position = stack?.members.findIndex((member) => member.number === number) ?? -1;
				return out(
					JSON.stringify({
						data: {
							repository: {
								pullRequest: {
									number,
									stackEntry:
										stack === undefined
											? null
											: {
													position: position + 1,
													stack: {
														number: stack.number,
														size: stack.members.length,
														baseRefName: stack.baseRefName,
													},
												},
								},
							},
						},
					}),
				);
			}
			// Each stack member's merge state, one alias per pull request number.
			if (args.some((arg) => /^pr\d+=\d+$/.test(arg))) {
				const repository: Record<string, unknown> = {};
				for (const arg of args) {
					const match = /^pr(\d+)=(\d+)$/.exec(arg);
					if (match === null) continue;
					const [, index, value] = match;
					const member = stacks
						.flatMap((stack) => stack.members)
						.find((candidate) => candidate.number === Number(value));
					repository[`pr${index}`] =
						member === undefined
							? null
							: { number: member.number, mergeStateStatus: member.mergeState };
				}
				return out(JSON.stringify({ data: { repository } }));
			}
			if (query.includes("reviewThreads")) {
				const number = Number(args.find((arg) => arg.startsWith("prNumber="))?.slice(9));
				const pr = prs.find((candidate) => candidate.number === number);
				return out(
					JSON.stringify({
						data: {
							repository: {
								pullRequest: {
									reviewThreads: {
										nodes: reviewThreadNodes(pr?.reviewComments ?? []),
										pageInfo: { hasNextPage: false, endCursor: null },
									},
								},
							},
						},
					}),
				);
			}
			if (query.includes("comments(")) {
				return out(
					JSON.stringify({
						data: {
							repository: {
								pullRequest: {
									comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
								},
							},
						},
					}),
				);
			}
			const repository: Record<string, unknown> = {
				viewerPermission: "WRITE",
				squashMergeAllowed: mergeMethods.squash,
				rebaseMergeAllowed: mergeMethods.rebase,
				mergeCommitAllowed: mergeMethods.merge,
			};
			for (const arg of args) {
				const match = /^headRefName(\d+)=(.*)$/.exec(arg);
				if (match === null) continue;
				const [, index, branch] = match;
				const pr = prs.find((candidate) => candidate.branch === branch);
				const byNumber = args.includes(`hasPrNumber${index}=true`);
				const node = pr === undefined ? null : pullRequestNode(pr);
				repository[`pr${index}${byNumber ? "ByNumber" : "ByBranch"}`] = byNumber
					? node
					: { nodes: node === null ? [] : [node] };
			}
			return out(
				JSON.stringify({
					data: { viewer: { login: "sam" }, rateLimit: { cost: 1, remaining: 4_990 }, repository },
				}),
			);
		}
		if (args[0] === "api" && /^repos\/[^/]+\/[^/]+\/issues\?/.test(args[1] ?? "")) {
			return out(
				JSON.stringify(
					issues.map((issue) => ({
						number: issue.number,
						title: issue.title,
						html_url: `https://github.com/acme/atlas/issues/${issue.number}`,
						state: "open",
						updated_at: iso(issue.updatedAt),
						body: null,
					})),
				),
			);
		}
		const stackPath = /^repos\/\{owner\}\/\{repo\}\/stacks\/(\d+)$/.exec(
			args[0] === "api" ? (args[1] ?? "") : "",
		);
		if (stackPath !== null) {
			const stack = stacks.find((candidate) => candidate.number === Number(stackPath[1]));
			if (stack === undefined) return out("", 1);
			return out(JSON.stringify({ pull_requests: stack.members.map(stackMemberNode) }));
		}
		// Whether a branch ever had a pull request, which a rename checks before it renames (GIT-13).
		if (args[0] === "pr" && args[1] === "list" && args.includes("--head")) {
			const branch = args[args.indexOf("--head") + 1];
			const found = prs
				.filter((pr) => pr.branch === branch)
				.map((pr) => ({
					state: pr.kind === "merged" ? "MERGED" : pr.kind === "closed" ? "CLOSED" : "OPEN",
				}));
			return out(JSON.stringify(found));
		}
		console.info("[catalogue] unscripted gh command:", joined.slice(0, 120));
		return null;
	};
}
