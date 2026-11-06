/**
 * @feature catalogue Scripted GitHub answers for catalogue workspaces
 * Owns: answering `gh` the way GitHub would for a signed-in user: the sign-in check, the user's login,
 * the batched pull request query (one pull request per head branch, or none) and empty review threads
 * and comments.
 * Behaviour: core/git/gh-commands.ts builds the commands; core/services/github.ts reads the answers
 * (parsePrBatchAnswers and the GraphQL node fields in PR_FIELDS_FRAGMENT).
 * Test first: not applicable; the screenshot run opens every state that uses it.
 */
import { ok, type Result } from "@conducted/shared";
import type { ShellScript } from "../platform/memory.ts";
import type { ShellOutput } from "../platform/platform.ts";

const out = (stdout: string, exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr: "", exitCode });

export type PrKind = "open" | "draft" | "ready" | "merged" | "failing";

export interface ScriptedPr {
	kind: PrKind;
	number: number;
	title: string;
	branch: string;
	base: string;
	/** When the pull request was opened, in milliseconds since the epoch. */
	createdAt: number;
}

const iso = (ms: number): string => new Date(ms).toISOString();

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
export function pullRequestNode(pr: ScriptedPr): Record<string, unknown> {
	const merged = pr.kind === "merged";
	const at = pr.createdAt;
	const checks =
		pr.kind === "open"
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
		body: "Keeps the page a user asked for when they sign in.\n\n- Reads `next` from the sign-in URL\n- Accepts paths on this site only",
		state: merged ? "MERGED" : "OPEN",
		isDraft: pr.kind === "draft",
		mergedAt: merged ? iso(at + 3 * 3_600_000) : null,
		mergeable: merged ? "UNKNOWN" : "MERGEABLE",
		mergeStateStatus: pr.kind === "ready" ? "CLEAN" : pr.kind === "merged" ? "UNKNOWN" : "BLOCKED",
		reviewDecision: pr.kind === "ready" || merged ? "APPROVED" : "REVIEW_REQUIRED",
		baseRefName: pr.base,
		baseRef: { target: { oid: "8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d" } },
		headRefName: pr.branch,
		headRefOid: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
		createdAt: iso(at),
		updatedAt: iso(at + 3_600_000),
		author: { login: "sam", avatarUrl: "" },
		viewerDidAuthor: true,
		viewerLatestReview: null,
		reviewRequests: { nodes: [] },
		latestReviews: {
			nodes:
				pr.kind === "ready" || merged
					? [
							{
								author: { login: "lee", avatarUrl: "" },
								state: "APPROVED",
								submittedAt: iso(at + 7_200_000),
							},
						]
					: [],
		},
		autoMergeRequest: null,
		mergeQueueEntry: null,
		headRef: merged
			? null
			: {
					target: {
						statusCheckRollup: { contexts: { nodes: checks } },
						deployments: { nodes: [] },
					},
				},
	};
}

/** Answers `gh` for a signed-in user whose pull requests are `prs`, keyed by head branch. */
export function scriptGitHub(prs: readonly ScriptedPr[]): ShellScript {
	return (command) => {
		if (command.program !== "gh") return null;
		const args = command.args;
		const joined = args.join(" ");
		if (joined === "auth status")
			return out("github.com\n  ✓ Logged in to github.com account sam\n");
		if (joined.startsWith("api user")) return out("sam\n");
		if (joined === "config get git_protocol") return out("ssh\n");
		if (args[0] === "api" && args[1] === "graphql") {
			const query = args.find((arg) => arg.startsWith("query=")) ?? "";
			if (query.includes("reviewThreads")) {
				return out(
					JSON.stringify({
						data: {
							repository: {
								pullRequest: {
									reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
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
				squashMergeAllowed: true,
				rebaseMergeAllowed: true,
				mergeCommitAllowed: true,
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
		return null;
	};
}
