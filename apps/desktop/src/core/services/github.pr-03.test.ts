import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import type { GitCache } from "./git-cache.ts";
import {
	GithubService,
	type PrWorkspaceContext,
	parseGraphqlBudget,
	parsePrBatchAnswer,
} from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "ws-1" as WorkspaceId;
const context: PrWorkspaceContext = {
	workspaceId,
	workspacePath: "/tmp/wt",
	branch: "local-name",
	remote: "origin",
	prNumber: null,
};

const output = (stdout = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, exitCode, stderr: "" });

type NodeOverrides = Record<string, unknown>;

function prNode(overrides: NodeOverrides = {}): Record<string, unknown> {
	return {
		number: 4,
		url: "https://github.com/o/r/pull/4",
		title: "T",
		body: null,
		state: "OPEN",
		isDraft: false,
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		reviewDecision: null,
		baseRefName: "main",
		baseRef: { target: { oid: "base-1" } },
		headRefName: "feature",
		headRefOid: "head-1",
		author: { login: "octocat", avatarUrl: "a" },
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-02T00:00:00Z",
		viewerDidAuthor: false,
		viewerLatestReview: null,
		reviewRequests: {
			nodes: [{ requestedReviewer: { login: "hubot", avatarUrl: "h" } }],
		},
		latestReviews: { nodes: [] },
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
				deployments: { nodes: [] },
			},
		},
		...overrides,
	};
}

function answer(node: Record<string, unknown> | null, overrides: NodeOverrides = {}): string {
	return JSON.stringify({
		data: {
			repository: {
				viewerPermission: "WRITE",
				squashMergeAllowed: true,
				rebaseMergeAllowed: true,
				mergeCommitAllowed: true,
				pr0ByNumber: node,
				pr0ByBranch: { nodes: node === null ? [] : [node] },
				...overrides,
			},
		},
	});
}

interface FakeOptions {
	graphql?: () => Promise<Result<ShellOutput>> | Result<ShellOutput>;
	stdout?: (command: GitCommand) => Result<string> | undefined;
}

interface FakeGit extends GitRunner {
	readonly runCommands: readonly GitCommand[];
}

function fakeGit(options: FakeOptions = {}): FakeGit {
	const runCommands: GitCommand[] = [];
	const git: FakeGit = {
		runCommands,
		async run(command: GitCommand, _options: GitRunOptions) {
			runCommands.push(command);
			if (command.program === "gh" && command.args[0] === "api") {
				if (command.args[1] === "graphql" && options.graphql !== undefined) {
					return options.graphql();
				}
				if (command.args[1] === "rate_limit") {
					return output(JSON.stringify({ resources: { graphql: { remaining: 5_000 } } }));
				}
				if (command.args[1] === "user") return output("octocat\n");
			}
			return output();
		},
		async runChecked(command, runOptions) {
			return git.run(command, runOptions);
		},
		async stdout(command) {
			const handled = options.stdout?.(command);
			if (handled !== undefined) return handled;
			if (command.program === "git" && command.args[0] === "config") {
				const key = command.args[2] ?? "";
				if (key.endsWith(".remote")) return ok("origin");
				if (key.endsWith(".merge")) return ok("refs/heads/feature");
				return ok("");
			}
			if (command.program === "git" && command.args[0] === "rev-parse") return ok("abc");
			return ok("");
		},
		async start() {
			throw new Error("not used");
		},
		withWorktreeLock: async (_path, work) => work(),
		withWorktreeAndRepoLocks: async (_path, _root, work) => work(),
	};
	return git;
}

function makeService(
	git: GitRunner,
	contextOf: (id: WorkspaceId) => Promise<Result<PrWorkspaceContext>> = async () => ok(context),
): GithubService {
	return new GithubService({
		git,
		cache: {} as GitCache,
		agent: {} as AgentMessenger,
		contextOf,
		onMerged: () => {},
		now: () => Date.now(),
		probeCwd: "/tmp",
	});
}

const flush = async (): Promise<void> => {
	for (let index = 0; index < 500; index += 1) await Promise.resolve();
};

afterEach(() => {
	vi.useRealTimers();
});

describe("PR-03 batched answer", () => {
	it("reads the node, the viewer's permission and the merge method", () => {
		const parsed = parsePrBatchAnswer(answer(prNode(), { squashMergeAllowed: false }));
		expect(parsed.ok).toBe(true);
		expect(parsed.ok && parsed.value.viewerCanMerge).toBe(true);
		expect(parsed.ok && parsed.value.mergeMethod).toBe("rebase");
		expect(parsed.ok && parsed.value.node?.number).toBe(4);
	});

	it("finds no node when the branch has no PR", () => {
		const parsed = parsePrBatchAnswer(answer(null));
		expect(parsed.ok && parsed.value.node).toBeNull();
	});

	it("refuses a bad answer instead of inventing an empty PR", () => {
		expect(parsePrBatchAnswer("not json").ok).toBe(false);
		expect(parsePrBatchAnswer(JSON.stringify({ data: {} })).ok).toBe(false);
		expect(parsePrBatchAnswer("null").ok).toBe(false);
	});

	it("reads the GraphQL budget and says when the host does not rate limit", () => {
		expect(
			parseGraphqlBudget(JSON.stringify({ resources: { graphql: { remaining: 4321 } } })),
		).toEqual(ok(4321));
		expect(parseGraphqlBudget(JSON.stringify({ resources: { graphql: {} } }))).toEqual(ok(null));
		expect(parseGraphqlBudget("not json").ok).toBe(false);
	});
});

describe("PR-03 polling a workspace", () => {
	it("maps the poll answer into the workspace's PR entry", async () => {
		const git = fakeGit({ graphql: () => output(answer(prNode())) });
		const service = makeService(git);

		expect(await service.pollNow(workspaceId)).toEqual(ok(undefined));

		const entry = service.store.getState().byWorkspace[workspaceId];
		expect(entry?.unavailable).toBe("none");
		expect(entry?.pullRequest).toMatchObject({
			number: 4,
			state: "open",
			mergeable: "mergeable",
			authorLogin: "octocat",
			viewerCanMerge: true,
			mergeMethod: "squash",
			updatedAt: Date.parse("2026-01-02T00:00:00Z"),
		});
		expect(entry?.pullRequest?.checks).toHaveLength(1);
		expect(entry?.pullRequest?.reviewers).toEqual([
			{ login: "hubot", avatarUrl: "h", state: "awaiting" },
		]);
	});

	it("asks nothing when the branch was never pushed and no PR number is bound", async () => {
		const git = fakeGit({
			graphql: () => output(answer(prNode())),
			stdout: (command) =>
				command.program === "git" && command.args[0] === "rev-parse" ? ok("") : undefined,
		});
		const service = makeService(git);

		expect(await service.pollNow(workspaceId)).toEqual(ok(undefined));

		expect(git.runCommands.some((command) => command.args[1] === "graphql")).toBe(false);
		expect(service.store.getState().byWorkspace[workspaceId]?.unavailable).toBe("no_pr");
	});

	it("remembers a no-PR answer for five minutes", async () => {
		let pushed = false;
		const git = fakeGit({
			graphql: () => output(answer(prNode())),
			stdout: (command) => {
				if (command.program === "git" && command.args[0] === "rev-parse") {
					return ok(pushed ? "abc" : "");
				}
				return undefined;
			},
		});
		const service = makeService(git);
		await service.pollNow(workspaceId);
		pushed = true;
		await service.pollNow(workspaceId);
		expect(git.runCommands.some((command) => command.args[1] === "graphql")).toBe(false);
	});

	it("keeps a known merge state when an UNKNOWN answer is for the same head", async () => {
		const answers = [
			answer(prNode({ mergeable: "CONFLICTING", headRefOid: "head-1" })),
			answer(prNode({ mergeable: "UNKNOWN", headRefOid: "head-1" })),
			answer(prNode({ mergeable: "UNKNOWN", headRefOid: "head-2" })),
		];
		let index = 0;
		const git = fakeGit({ graphql: () => output(answers[index++] ?? answers[2]) });
		const service = makeService(git);

		await service.pollNow(workspaceId);
		expect(service.store.getState().byWorkspace[workspaceId]?.pullRequest?.mergeable).toBe(
			"conflicting",
		);
		await service.pollNow(workspaceId);
		expect(service.store.getState().byWorkspace[workspaceId]?.pullRequest?.mergeable).toBe(
			"conflicting",
		);
		await service.pollNow(workspaceId);
		expect(service.store.getState().byWorkspace[workspaceId]?.pullRequest?.mergeable).toBe(
			"unknown",
		);
	});

	it("drops a closed PR whose head no longer matches the local branch", async () => {
		const git = fakeGit({
			graphql: () =>
				output(answer(prNode({ state: "CLOSED", mergeable: "UNKNOWN", headRefName: "other" }))),
		});
		const service = makeService(git);

		await service.pollNow(workspaceId);

		expect(service.store.getState().byWorkspace[workspaceId]).toMatchObject({
			pullRequest: null,
			unavailable: "no_pr",
		});
	});

	it("lets only the newest overlapping poll write the entry", async () => {
		let releaseFirst: ((value: Result<ShellOutput>) => void) | undefined;
		const first = new Promise<Result<ShellOutput>>((resolve) => {
			releaseFirst = resolve;
		});
		const second = answer(prNode({ title: "new", headRefOid: "head-2" }));
		const firstAnswer = answer(prNode({ title: "old", headRefOid: "head-1" }));
		let call = 0;
		const git = fakeGit({
			graphql: () => {
				call += 1;
				return call === 1 ? first : output(second);
			},
		});
		const service = makeService(git);

		const older = service.pollNow(workspaceId);
		const newer = service.pollNow(workspaceId);
		await newer;
		releaseFirst?.(output(firstAnswer));
		await older;

		expect(service.store.getState().byWorkspace[workspaceId]?.pullRequest?.title).toBe("new");
	});

	it("records the failure and keeps the last PR", async () => {
		const git = fakeGit({
			graphql: () =>
				err(appError("git_failed", "dial tcp: connection refused")) as Result<ShellOutput>,
		});
		const service = makeService(git);

		const result = await service.pollNow(workspaceId);

		expect(result.ok).toBe(false);
		expect(service.store.getState().byWorkspace[workspaceId]?.unavailable).toBe("offline");
	});
});

describe("PR-03 watching a workspace", () => {
	it("polls at once, again after the interval, and stops when unsubscribed", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.parse("2026-01-02T00:00:00Z"));
		let polls = 0;
		const git = fakeGit({
			graphql: () => {
				polls += 1;
				return output(answer(prNode()));
			},
		});
		const service = makeService(git);

		const stop = service.watch(workspaceId, "selected");
		await vi.advanceTimersByTimeAsync(0);
		await flush();
		expect(polls).toBe(1);

		await vi.advanceTimersByTimeAsync(5_000);
		await flush();
		expect(polls).toBe(2);

		stop();
		await vi.advanceTimersByTimeAsync(20_000);
		await flush();
		expect(polls).toBe(2);
	});

	it("shares one timer between two watchers of a workspace", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.parse("2026-01-02T00:00:00Z"));
		let polls = 0;
		const git = fakeGit({
			graphql: () => {
				polls += 1;
				return output(answer(prNode()));
			},
		});
		const service = makeService(git);

		const first = service.watch(workspaceId, "sidebar");
		const second = service.watch(workspaceId, "sidebar");
		await vi.advanceTimersByTimeAsync(0);
		await flush();
		expect(polls).toBe(1);
		first();
		second();
		await vi.advanceTimersByTimeAsync(300_000);
		await flush();
		expect(polls).toBe(1);
	});
});
