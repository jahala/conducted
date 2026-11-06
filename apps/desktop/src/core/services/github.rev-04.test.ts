// @vitest-environment node
/**
 * @feature REV-04 Sync review comments with GitHub
 * Tests GitHub's side of the sync: the review threads query and its extra comment pages, the
 * general comments query, resolving a thread through GraphQL, and the poll change that starts a
 * sync.
 * Behaviour: services-map.md 3.7.4 and 5A.7.3.
 * Test first: a thread whose comments cross a page asks for the rest with the thread id and cursor.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import { GithubService, type PrWorkspaceContext } from "./github.ts";

const workspaceId = "ws-rev-04" as WorkspaceId;
const context: PrWorkspaceContext = {
	workspaceId,
	workspacePath: "/wt",
	branch: "feat",
	remote: "origin",
	prNumber: 12,
	targetBranch: "origin/main",
};

function makeService(
	git: FakeGitRunner,
	onPullRequestChanged?: (id: WorkspaceId) => void,
): GithubService {
	return new GithubService({
		git,
		agent: {} as never,
		contextOf: async () => ok(context),
		onMerged: () => {},
		...(onPullRequestChanged === undefined ? {} : { onPullRequestChanged }),
		now: () => 1_000,
		probeCwd: "/tmp",
	});
}

function graphqlCommand(git: FakeGitRunner): GitCommand[] {
	return git.commands.filter(
		(command) => command.program === "gh" && command.args.includes("graphql"),
	);
}

function queryOf(command: GitCommand): string {
	return command.args.find((arg) => arg.startsWith("query=")) ?? "";
}

function threadComment(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		id: "PRRC_1",
		databaseId: 101,
		body: "Please rename this.",
		diffHunk: "@@ -1,3 +1,3 @@",
		url: "https://github.com/o/r/pull/12#discussion_r101",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-02T00:00:00Z",
		lastEditedAt: null,
		author: { login: "octocat", avatarUrl: "https://avatars.example/octocat" },
		replyTo: null,
		...overrides,
	};
}

function threadNode(
	comments: Record<string, unknown>[],
	pageInfo: Record<string, unknown> = { hasNextPage: false, endCursor: null },
): Record<string, unknown> {
	return {
		id: "PRT_1",
		isOutdated: false,
		isResolved: true,
		path: "src/a.ts",
		line: 5,
		startLine: 3,
		originalLine: 5,
		originalStartLine: 3,
		startDiffSide: "RIGHT",
		diffSide: "RIGHT",
		comments: { pageInfo, nodes: comments },
	};
}

function threadsAnswer(
	nodes: Record<string, unknown>[],
	pageInfo: Record<string, unknown> = { hasNextPage: false, endCursor: null },
): string {
	return JSON.stringify({
		data: {
			rateLimit: { cost: 1 },
			repository: {
				pullRequest: {
					reviewThreads: { pageInfo, nodes },
				},
			},
		},
	});
}

describe("REV-04 GitHub review thread read", () => {
	it("reads review threads with a GraphQL threads query", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:octo/repo.git\n");
			return gitOutput(threadsAnswer([threadNode([threadComment()])]));
		});
		const service = makeService(git);

		const read = await service.readReviewThreads(workspaceId);

		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value).toHaveLength(1);
		expect(read.value[0]).toMatchObject({
			id: "PRT_1",
			path: "src/a.ts",
			line: 5,
			startLine: 3,
			diffSide: "RIGHT",
			isResolved: true,
			comments: [
				{
					databaseId: 101,
					body: "Please rename this.",
					authorLogin: "octocat",
				},
			],
		});
		expect(queryOf(graphqlCommand(git)[0] ?? { program: "", args: [] })).toContain("reviewThreads");
	});

	it("asks for a thread's remaining comments with the thread id and cursor", async () => {
		const answers = [
			threadsAnswer([threadNode([threadComment()], { hasNextPage: true, endCursor: "c2" })]),
			JSON.stringify({
				data: {
					node: {
						comments: {
							pageInfo: { hasNextPage: false, endCursor: null },
							nodes: [
								threadComment({
									id: "PRRC_2",
									databaseId: 102,
									body: "Second page",
								}),
							],
						},
					},
				},
			}),
		];
		let answer = 0;
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:octo/repo.git\n");
			const value = answers[answer] ?? answers[answers.length - 1] ?? "";
			answer += 1;
			return gitOutput(value);
		});
		const service = makeService(git);

		const read = await service.readReviewThreads(workspaceId);

		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value[0]?.comments.map((entry) => entry.databaseId)).toEqual([101, 102]);
		const followUp = graphqlCommand(git)[1];
		expect(followUp).toBeDefined();
		expect(queryOf(followUp as GitCommand)).toContain("ReviewThreadComments");
		expect(followUp?.args).toContain("threadId=PRT_1");
		expect(followUp?.args).toContain("cursor=c2");
	});

	it("reads general PR comments with their own query", async () => {
		const answer = JSON.stringify({
			data: {
				rateLimit: { cost: 1 },
				repository: {
					pullRequest: {
						comments: {
							pageInfo: { hasNextPage: false, endCursor: null },
							nodes: [
								{
									id: "PRRC_200",
									databaseId: 200,
									body: "Thanks for the change.",
									url: "https://github.com/o/r/pull/12#issuecomment-200",
									createdAt: "2026-01-01T00:00:00Z",
									updatedAt: "2026-01-01T00:00:00Z",
									lastEditedAt: null,
									author: { login: "reviewer", avatarUrl: null },
								},
							],
						},
					},
				},
			},
		});
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:octo/repo.git\n");
			return gitOutput(answer);
		});
		const service = makeService(git);

		const read = await service.readGeneralComments(workspaceId);

		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value).toEqual([
			expect.objectContaining({ databaseId: 200, body: "Thanks for the change." }),
		]);
		expect(queryOf(graphqlCommand(git)[0] ?? { program: "", args: [] })).toContain(
			"PullRequestComments",
		);
	});

	it("refuses to sync a repository whose remote is not GitHub", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("https://gitlab.com/octo/repo.git\n");
			return gitOutput(threadsAnswer([]));
		});
		const service = makeService(git);

		const read = await service.readReviewThreads(workspaceId);

		expect(read).toMatchObject({ ok: false, error: { code: "github_not_github" } });
		expect(graphqlCommand(git)).toHaveLength(0);
	});

	it("resolves a review thread through the GraphQL mutation", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:octo/repo.git\n");
			return gitOutput(
				JSON.stringify({
					data: { resolveReviewThread: { thread: { id: "PRT_1", isResolved: true } } },
				}),
			);
		});
		const service = makeService(git);

		const result = await service.resolveReviewThread(workspaceId, "PRT_1");

		expect(result).toEqual(ok(undefined));
		const call = graphqlCommand(git)[0];
		expect(call?.args).toContain("threadId=PRT_1");
		expect(queryOf(call as GitCommand)).toContain("resolveReviewThread");
	});
});

describe("REV-04 GitHub comment sync from the poll", () => {
	const node = (updatedAt: string): Record<string, unknown> => ({
		number: 12,
		url: "https://github.com/octo/repo/pull/12",
		title: "Add the parser",
		body: null,
		state: "OPEN",
		isDraft: false,
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		reviewDecision: null,
		baseRefName: "main",
		headRefName: "feat",
		headRefOid: "abc123",
		author: { login: "octocat", avatarUrl: null },
		baseRef: { target: { oid: "base123" } },
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt,
		viewerDidAuthor: false,
		reviewRequests: { nodes: [] },
		latestReviews: { nodes: [] },
		viewerLatestReview: null,
		autoMergeRequest: null,
		mergeQueueEntry: null,
		headRef: {
			target: {
				statusCheckRollup: { contexts: { nodes: [] } },
				deployments: { nodes: [] },
			},
		},
	});

	it("starts a review-comment sync when an open PR's updatedAt changes", async () => {
		let updatedAt = "2026-01-02T00:00:00Z";
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") {
				if (command.args[0] === "remote") return gitOutput("git@github.com:octo/repo.git\n");
				if (command.args[0] === "config") {
					return gitOutput(
						command.args[2]?.endsWith(".remote") === true ? "origin\n" : "refs/heads/feat\n",
					);
				}
				if (command.args[0] === "rev-parse") return gitOutput("/repo/.git\n");
				return gitOutput("abc123\n");
			}
			return gitOutput(
				JSON.stringify({
					data: {
						viewer: { login: "me" },
						rateLimit: { cost: 1, remaining: 5_000 },
						repository: {
							viewerPermission: "WRITE",
							squashMergeAllowed: true,
							rebaseMergeAllowed: true,
							mergeCommitAllowed: true,
							pr0ByNumber: node(updatedAt),
						},
					},
				}),
			);
		});
		const changed: WorkspaceId[] = [];
		const service = makeService(git, (id) => changed.push(id));

		expect((await service.pollNow(workspaceId)).ok).toBe(true);
		expect(changed).toEqual([workspaceId]);

		expect((await service.pollNow(workspaceId)).ok).toBe(true);
		expect(changed).toEqual([workspaceId]);

		updatedAt = "2026-01-03T00:00:00Z";
		expect((await service.pollNow(workspaceId)).ok).toBe(true);
		expect(changed).toEqual([workspaceId, workspaceId]);
	});
});
