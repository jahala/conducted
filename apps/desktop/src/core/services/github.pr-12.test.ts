// @vitest-environment node
/**
 * @feature PR-12 Catch up a stack branch after GitHub rewrites it
 * Owns: the guarded automatic catch-up. Each skip reason, the sequence-editor environment, the
 * rebase onto the rewritten upstream, the baseline compare-and-swap, the abort of a failed rebase,
 * and the timed poll that starts the catch-up without a user action.
 * Behaviour: services-map.md 3.8.3 (steps 1 to 8), 5B.1.1 (auto stack sync), 3.0.3 (locks).
 * Test first: a diverged stack branch whose local tip the upstream reflog once held is rebased onto
 * the rewritten upstream, and the baseline ref takes the new tip.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { FakeGitRunner, type GitAnswer, gitOutput } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { PullRequest } from "../model.ts";
import { GithubService } from "./github.ts";

const workspaceId = "ws-1" as WorkspaceId;

interface CatchUpState {
	branchRef: string;
	branch: string;
	head: string;
	upstreamRef: string;
	upstream: string;
	remote: string;
	remoteUrl: string;
	left: number;
	right: number;
	baseline: string;
	reflog: string;
	status: string;
	operation: "none" | "rebase";
	ignored: string;
	added: string;
	inStack: boolean;
	rebaseExit: number;
	rebaseStderr: string;
	afterHead: string;
	aborted: boolean;
}

function catchUpState(overrides: Partial<CatchUpState> = {}): CatchUpState {
	return {
		branchRef: "refs/heads/feat-b",
		branch: "feat-b",
		head: "local-1",
		upstreamRef: "refs/remotes/origin/feat-b",
		upstream: "upstream-1",
		remote: "origin",
		remoteUrl: "git@github.com:o/r.git\n",
		left: 1,
		right: 1,
		baseline: "",
		reflog: "upstream-1\nlocal-1\n",
		status: "",
		operation: "none",
		ignored: "",
		added: "",
		inStack: true,
		rebaseExit: 0,
		rebaseStderr: "",
		afterHead: "new-tip",
		aborted: false,
		...overrides,
	};
}

const stackAnswer = (entry: unknown): string =>
	JSON.stringify({ data: { repository: { pullRequest: { number: 12, stackEntry: entry } } } });

const stackEntry = {
	position: 2,
	stack: { number: 5, size: 2, baseRefName: "main" },
};

const membersAnswer = (): string =>
	JSON.stringify({
		pull_requests: [
			{
				number: 11,
				title: "Below",
				state: "OPEN",
				draft: false,
				merged_at: null,
				head: { ref: "feat-a", sha: "a1" },
				base: { ref: "main", sha: "m0" },
			},
			{
				number: 12,
				title: "Current",
				state: "OPEN",
				draft: false,
				merged_at: null,
				head: { ref: "feat-b", sha: "local-1" },
				base: { ref: "feat-a", sha: "a1" },
			},
		],
	});

const readinessAnswer = (): string =>
	JSON.stringify({
		data: {
			repository: {
				pr0: { number: 11, mergeStateStatus: "CLEAN" },
				pr1: { number: 12, mergeStateStatus: "CLEAN" },
			},
		},
	});

const pollAnswer = (): string =>
	JSON.stringify({
		data: {
			rateLimit: { cost: 1, remaining: 5_000 },
			repository: {
				viewerPermission: "WRITE",
				squashMergeAllowed: true,
				rebaseMergeAllowed: true,
				mergeCommitAllowed: true,
				pr0ByNumber: {
					number: 12,
					url: "https://github.com/o/r/pull/12",
					title: "Current",
					body: null,
					state: "OPEN",
					isDraft: false,
					mergeable: "MERGEABLE",
					mergeStateStatus: "CLEAN",
					reviewDecision: null,
					baseRefName: "main",
					baseRef: { target: { oid: "m0" } },
					headRefName: "feat-b",
					headRefOid: "local-1",
					author: { login: "octocat", avatarUrl: null },
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-02T00:00:00Z",
					viewerDidAuthor: false,
					viewerLatestReview: null,
					reviewRequests: { nodes: [] },
					latestReviews: { nodes: [] },
					autoMergeRequest: null,
					mergeQueueEntry: null,
					headRef: {
						target: {
							statusCheckRollup: { contexts: { nodes: [] } },
							deployments: { nodes: [] },
						},
					},
				},
				pr0ByBranch: { nodes: [] },
			},
		},
	});

function answer(command: GitCommand, state: CatchUpState): GitAnswer {
	if (command.program === "stat") {
		const path = command.args.at(-1) ?? "";
		const present = state.operation === "rebase" && path.endsWith("rebase-merge");
		return gitOutput("", "", present ? 0 : 1);
	}
	if (command.program === "gh") {
		if (command.args.includes("graphql")) {
			if (command.args.some((arg) => arg.includes("PrFields"))) {
				return gitOutput(pollAnswer());
			}
			if (command.args.some((arg) => arg.includes("stackEntry"))) {
				return gitOutput(stackAnswer(state.inStack ? stackEntry : null));
			}
			if (command.args.some((arg) => arg.includes("mergeStateStatus"))) {
				return gitOutput(readinessAnswer());
			}
			return gitOutput();
		}
		if (command.args[0] === "api" && command.args[1] === "rate_limit") {
			return gitOutput(JSON.stringify({ resources: { graphql: { remaining: 5_000 } } }));
		}
		if (command.args[1]?.includes("/stacks/5") === true) return gitOutput(membersAnswer());
		return gitOutput();
	}
	if (command.program !== "git") return gitOutput();
	switch (command.args[0]) {
		case "symbolic-ref":
			return gitOutput(state.branchRef, "", state.branchRef === "" ? 128 : 0);
		case "rev-parse": {
			if (command.args.includes("--git-path")) {
				return gitOutput(`/repo/.git/${command.args[2] ?? ""}\n`);
			}
			if (command.args.includes("--git-common-dir")) return gitOutput("/repo/.git\n");
			if (command.args.includes("--symbolic-full-name")) {
				return gitOutput(state.upstreamRef, "", state.upstreamRef === "" ? 128 : 0);
			}
			if (command.args.includes("--verify")) {
				if (command.args.some((arg) => arg.startsWith("refs/worktree/"))) {
					return gitOutput(state.baseline, "", state.baseline === "" ? 1 : 0);
				}
				return gitOutput(state.upstream, "", state.upstream === "" ? 1 : 0);
			}
			if (command.args[1] === "HEAD") return gitOutput(state.head);
			return gitOutput();
		}
		case "config": {
			const key = command.args[2] ?? "";
			if (key.endsWith(".merge")) return gitOutput(`refs/heads/${state.branch}\n`);
			return gitOutput(state.remote);
		}
		case "remote":
			return gitOutput(state.remoteUrl);
		case "hash-object":
			return gitOutput(`hash:${command.stdin ?? ""}`);
		case "rev-list":
			return gitOutput(`${state.left}\t${state.right}\n`);
		case "reflog":
			return gitOutput(state.reflog);
		case "status":
			return gitOutput(state.status);
		case "ls-files":
			return gitOutput(state.ignored);
		case "diff-tree":
			return gitOutput(state.added);
		case "rebase":
			if (command.args[1] === "--abort") {
				state.aborted = true;
				state.operation = "none";
				return gitOutput();
			}
			if (state.rebaseExit === 0) state.head = state.afterHead;
			else state.operation = "rebase";
			return gitOutput("", state.rebaseStderr, state.rebaseExit);
		default:
			return gitOutput();
	}
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
	return {
		number: 12,
		url: "https://github.com/o/r/pull/12",
		title: "Current",
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
		updatedAt: 1,
		...overrides,
	};
}

function makeService(state: CatchUpState): { service: GithubService; git: FakeGitRunner } {
	const git = new FakeGitRunner((command) => answer(command, state));
	const service = new GithubService({
		git,
		agent: {} as never,
		contextOf: async () =>
			ok({
				workspaceId,
				workspacePath: "/wt",
				repoRootPath: "/repo",
				branch: state.branch,
				remote: "origin",
				prNumber: 12,
			}),
		onMerged: () => {},
		now: () => Date.now(),
		probeCwd: "/tmp",
	});
	return { service, git };
}

function showPullRequest(service: GithubService, overrides: Partial<PullRequest> = {}): void {
	service.store.setState({
		byWorkspace: {
			[workspaceId]: {
				pullRequest: pullRequest(overrides),
				unavailable: "none",
				fetchedAt: 1,
			},
		},
	});
}

const rebaseCalls = (git: FakeGitRunner) =>
	git.commands.filter(
		(command) => command.args[0] === "rebase" && command.args[1] === "--interactive",
	);

const updateRefCalls = (git: FakeGitRunner) =>
	git.commands.filter(
		(command) => command.args[0] === "update-ref" && command.args[1] === "--stdin",
	);

describe("PR-12 catching up a rewritten stack branch", () => {
	it("rebases onto the rewritten upstream and moves the baseline to the new tip", async () => {
		const state = catchUpState();
		const { service, git } = makeService(state);
		showPullRequest(service);

		const result = await service.catchUpStackBranch(workspaceId);

		expect(result).toEqual(ok({ kind: "rebased", newTip: "new-tip" }));
		const rebase = rebaseCalls(git);
		expect(rebase).toHaveLength(1);
		expect(rebase[0]?.args).toEqual([
			"rebase",
			"--interactive",
			"--no-autostash",
			"--no-update-refs",
			"--no-autosquash",
			"--no-rebase-merges",
			"--no-fork-point",
			"--onto",
			"upstream-1",
			"local-1",
		]);
		const update = updateRefCalls(git);
		expect(update).toHaveLength(1);
		expect(update[0]?.stdin).toContain("create refs/worktree/conducted/synced/");
		expect(update[0]?.stdin).toContain("new-tip");
		// The rebase runs under the worktree lock and then the repo lock (3.0.3).
		expect(git.worktreeLocks).toEqual(["/wt"]);
		expect(git.repoLocks).toEqual(["/repo"]);
	});

	it("passes the planned identity to the sequence editor", async () => {
		const state = catchUpState();
		const { service, git } = makeService(state);
		showPullRequest(service);

		await service.catchUpStackBranch(workspaceId);

		const rebase = git.calls.find(
			(call) => call.command.args[0] === "rebase" && call.command.args[1] === "--interactive",
		);
		expect(rebase?.options.env?.CONDUCTED_CATCH_UP_HEAD_REF).toBe("refs/heads/feat-b");
		expect(rebase?.options.env?.CONDUCTED_CATCH_UP_LOCAL_OID).toBe("local-1");
		expect(rebase?.options.env?.CONDUCTED_CATCH_UP_UPSTREAM_OID).toBe("upstream-1");
		expect(rebase?.options.env?.GIT_SEQUENCE_EDITOR).toContain("sh -c");
	});

	it("accepts a baseline that already equals the local tip", async () => {
		const state = catchUpState({ baseline: "local-1", reflog: "" });
		const { service, git } = makeService(state);
		showPullRequest(service);

		const result = await service.catchUpStackBranch(workspaceId);

		expect(result.ok && result.value.kind).toBe("rebased");
		expect(updateRefCalls(git)[0]?.stdin).toContain("update refs/worktree/conducted/synced/");
	});

	it("updates the baseline with a compare-and-swap when it exists", async () => {
		const state = catchUpState({ baseline: "local-1" });
		const { service, git } = makeService(state);
		showPullRequest(service);

		await service.catchUpStackBranch(workspaceId);

		expect(updateRefCalls(git)[0]?.stdin).toContain("local-1");
	});
});

describe("PR-12 what the catch-up refuses", () => {
	it("skips when stacked pull requests are turned off", async () => {
		const state = catchUpState();
		const git = new FakeGitRunner((command) => answer(command, state));
		const service = new GithubService({
			git,
			agent: {} as never,
			contextOf: async () =>
				ok({
					workspaceId,
					workspacePath: "/wt",
					repoRootPath: "/repo",
					branch: "feat-b",
					remote: "origin",
					prNumber: 12,
				}),
			onMerged: () => {},
			now: () => 1_000,
			probeCwd: "/tmp",
			setting: <T>(_key: string): T => false as unknown as T,
		});
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "not_in_stack" }),
		);
		expect(rebaseCalls(git)).toHaveLength(0);
	});

	it("skips a workspace with no pull request", async () => {
		const state = catchUpState();
		const { service } = makeService(state);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "not_in_stack" }),
		);
	});

	it("skips a user without write permission", async () => {
		const state = catchUpState();
		const { service, git } = makeService(state);
		showPullRequest(service, { viewerCanMerge: false });

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "no_write_permission" }),
		);
		expect(rebaseCalls(git)).toHaveLength(0);
	});

	it("skips a pull request that is no longer open", async () => {
		const state = catchUpState();
		const { service, git } = makeService(state);
		showPullRequest(service, { state: "merged" });

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "not_in_stack" }),
		);
		expect(rebaseCalls(git)).toHaveLength(0);
	});

	it("skips a detached head", async () => {
		const state = catchUpState({ branchRef: "" });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "detached_head" }),
		);
	});

	it("skips a branch name that changed", async () => {
		const state = catchUpState({ branchRef: "refs/heads/other" });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "identity_changed" }),
		);
	});

	it("skips a remote that no longer matches the workspace", async () => {
		const state = catchUpState({ remote: "upstream" });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "identity_changed" }),
		);
	});

	it("skips a branch that is not diverged", async () => {
		const onlyBehind = catchUpState({ left: 1, right: 0 });
		const behindService = makeService(onlyBehind);
		showPullRequest(behindService.service);
		expect(await behindService.service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "not_diverged" }),
		);

		const equal = catchUpState({ head: "same", upstream: "same" });
		const equalService = makeService(equal);
		showPullRequest(equalService.service);
		expect(await equalService.service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "not_diverged" }),
		);
	});

	it("skips a branch that is not in a GitHub stack", async () => {
		const state = catchUpState({ inStack: false });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "not_in_stack" }),
		);
	});

	it("skips a missing baseline the upstream reflog never held", async () => {
		const state = catchUpState({ baseline: "", reflog: "upstream-1\n" });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "no_baseline" }),
		);
	});

	it("skips a changed local tip the reflog cannot explain", async () => {
		const state = catchUpState({ baseline: "older-tip", reflog: "upstream-1\n" });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "identity_changed" }),
		);
	});

	it("skips a dirty tree", async () => {
		const state = catchUpState({ status: " M src/file.ts\n" });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "dirty_tree" }),
		);
	});

	it("skips while another git operation is in progress", async () => {
		const state = catchUpState({ operation: "rebase" });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "operation_in_progress" }),
		);
	});

	it("skips when the rebase would overwrite an ignored file", async () => {
		const state = catchUpState({ ignored: "build/\0", added: "build/out.js\0" });
		const { service } = makeService(state);
		showPullRequest(service);

		expect(await service.catchUpStackBranch(workspaceId)).toEqual(
			ok({ kind: "skipped", reason: "ignored_file_collision" }),
		);
	});

	it("refuses when the repository's main folder is not known", async () => {
		const git = new FakeGitRunner((command) => answer(command, catchUpState()));
		const service = new GithubService({
			git,
			agent: {} as never,
			contextOf: async () =>
				ok({
					workspaceId,
					workspacePath: "/wt",
					branch: "feat-b",
					remote: "origin",
					prNumber: 12,
				}),
			onMerged: () => {},
			now: () => 1_000,
			probeCwd: "/tmp",
		});
		showPullRequest(service);

		const result = await service.catchUpStackBranch(workspaceId);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("github_repo_root_unknown");
		expect(rebaseCalls(git)).toHaveLength(0);
	});
});

describe("PR-12 a rebase that stops partway", () => {
	it("aborts the rebase and hands back the failure", async () => {
		const state = catchUpState({
			rebaseExit: 1,
			rebaseStderr: "CONFLICT (content): merge conflict",
		});
		const { service, git } = makeService(state);
		showPullRequest(service);

		const result = await service.catchUpStackBranch(workspaceId);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("merge conflict");
		expect(state.aborted).toBe(true);
		expect(git.commands.some((command) => command.args.join(" ") === "rebase --abort")).toBe(true);
		expect(updateRefCalls(git)).toHaveLength(0);
	});
});

describe("PR-12 the timed poll catches a stack branch up on its own", () => {
	it("rebases after the poll sees the branch", async () => {
		const state = catchUpState();
		const { service, git } = makeService(state);

		const stop = service.watch(workspaceId, "selected");
		try {
			await vi.waitFor(() => expect(rebaseCalls(git)).toHaveLength(1));
		} finally {
			stop();
		}

		expect(service.store.getState().byWorkspace[workspaceId]?.pullRequest?.number).toBe(12);
	});
});
