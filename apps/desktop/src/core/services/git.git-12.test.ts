/**
 * @feature GIT-12 Branch lists, branch commits and switch branch
 * Owns: the tests for listing a repository's branches, keeping that list fresh, and switching a
 * workspace to another branch.
 * Behaviour: services-map.md 3.3.1 (5 s foreground and 60 s other repositories), 3.3.3 (repo
 * branches), 3.6.6 (remote branches), 3.11 (fetch, checkout, fast-forward only).
 * Test first: a switch fetches the branch, checks it out and fast-forwards it when it can.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import {
	BRANCH_BACKGROUND_POLL_INTERVAL_MS,
	BRANCH_POLL_INTERVAL_MS,
	GitService,
	parseRemoteBranches,
	type WorkspaceGitContext,
} from "./git.ts";

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

const workspaceId = "ws-git-12" as WorkspaceId;
const repoRoot = "/repo";
const start = 1_000_000;

const context = (branch = "feat"): WorkspaceGitContext => ({
	workspaceId,
	workspacePath: "/repo/worktree",
	repoRootPath: repoRoot,
	remote: "origin",
	targetBranch: "origin/main",
	branch,
});

interface Harness {
	runner: GitRunner;
	commands: GitCommand[];
	fetches: GitCommand[];
	checkouts: GitCommand[];
	merges: GitCommand[];
	renamedTo: string[];
}

function harness(
	answer: (
		command: GitCommand,
		options: GitRunOptions,
	) => Result<ShellOutput> | Promise<Result<ShellOutput>>,
): Harness {
	const commands: GitCommand[] = [];
	const fetches: GitCommand[] = [];
	const checkouts: GitCommand[] = [];
	const merges: GitCommand[] = [];
	const renamedTo: string[] = [];
	const runner = new FakeGitRunner(async (command, options) => {
		commands.push(command);
		if (command.args[0] === "fetch") fetches.push(command);
		if (command.args[0] === "checkout") checkouts.push(command);
		if (command.args[0] === "merge") merges.push(command);
		return answer(command, options);
	});
	return { runner, commands, fetches, checkouts, merges, renamedTo };
}

function makeService(
	runner: GitRunner,
	options: {
		contextOf?: () => WorkspaceGitContext;
		now?: () => number;
		renamedTo?: string[];
	} = {},
): GitService {
	return new GitService({
		git: runner,
		contextOf: async () => ok(options.contextOf?.() ?? context()),
		agent: {} as never,
		renameWorkspaceBranch: async (_id, branch) => {
			options.renamedTo?.push(branch);
			return ok(undefined);
		},
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
		now: options.now ?? (() => start),
		fs: {
			trash: async () => ok(undefined),
			readText: async () => err(appError("fs_not_found", "missing")),
			writeTextAtomic: async () => ok(undefined),
			mkdirp: async () => ok(undefined),
			stat: async () => err(appError("fs_not_found", "missing")),
			paths: { home: "", appData: "", temp: "", resources: "" },
		},
	});
}

/** Answers the workspace poll that runs after a switch. */
function pollAnswer(command: GitCommand, branch: string): Result<ShellOutput> | null {
	const args = command.args;
	if (command.program === "stat") return ok(output("", "", 1));
	if (args[0] === "branch" && args[1] === "--show-current") return ok(output(`${branch}\n`));
	if (args[0] === "rev-parse" && args[1] === "--git-path") {
		return ok(output(`/git/${args.at(-1)}\n`));
	}
	if (args[0] === "merge-base" && args[1] !== "--is-ancestor") return ok(output("mb\n"));
	if (args[0] === "diff") return ok(output(""));
	if (args[0] === "status") return ok(output(""));
	if (args[0] === "ls-files") return ok(output(""));
	if (args[0] === "rev-parse" && args[1] === "HEAD") {
		return ok(output("", "fatal: no upstream", 128));
	}
	if (args[0] === "rev-list") return ok(output("0\n"));
	return null;
}

function branchListAnswer(
	local: string,
	remote: string,
	worktrees: string,
): (command: GitCommand) => Result<ShellOutput> {
	return (command) => {
		const args = command.args;
		if (args[0] === "fetch") return ok(output(""));
		if (args[0] === "branch" && args[1]?.startsWith("--format")) return ok(output(local));
		if (args[0] === "for-each-ref") return ok(output(remote));
		if (args[0] === "worktree" && args[1] === "list") return ok(output(worktrees));
		return err(appError("git_unscripted", "unexpected command"));
	};
}

/** Resolves on the next branch-list write to the store, never after a fixed delay. */
function nextBranchUpdate(service: GitService): Promise<void> {
	return new Promise((resolve) => {
		const unsubscribe = service.store.subscribe(() => {
			unsubscribe();
			resolve();
		});
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe("GIT-12 branch lists", () => {
	it("parses remote branches, dropping the remote HEAD and its prefix", () => {
		expect(
			parseRemoteBranches(
				"origin/main\norigin/release/1\norigin/HEAD\nrefs/remotes/origin/feat\n",
				"origin",
			),
		).toEqual(["main", "release/1", "feat"]);
	});

	it("fetches the remote, then reads local, remote and checked-out branches", async () => {
		const h = harness(
			branchListAnswer(
				"main\nrelease/1\n",
				"origin/main\norigin/release/1\norigin/feature\n",
				"worktree /repo\nHEAD aaa\nbranch refs/heads/main\n\nworktree /other\nHEAD bbb\nbranch refs/heads/other\n",
			),
		);
		const service = makeService(h.runner);

		const result = await service.listBranches(repoRoot, "origin");

		expect(result).toEqual(
			ok({
				local: ["main", "release/1"],
				remote: ["main", "release/1", "feature"],
				checkedOut: ["main", "other"],
			}),
		);
		expect(h.fetches).toHaveLength(1);
		expect(h.fetches[0]?.args).toEqual([
			"fetch",
			"--no-write-fetch-head",
			"--prune",
			"--",
			"origin",
		]);
		expect(h.commands.every((command) => command.program === "git")).toBe(true);
		expect(service.branchesOf(repoRoot)?.branches?.remote).toEqual([
			"main",
			"release/1",
			"feature",
		]);
	});

	it("reads branches without fetching when the watcher refreshes them", async () => {
		const h = harness(branchListAnswer("main\n", "origin/main\n", "worktree /repo\nHEAD aaa\n"));
		const service = makeService(h.runner);

		expect(await service.refreshBranches(repoRoot, "origin")).toEqual(ok(undefined));

		expect(h.fetches).toHaveLength(0);
	});

	it("lets only the newest branch read change the store", async () => {
		let branchReads = 0;
		let releaseFirst: (() => void) | undefined;
		const h = harness((command) => {
			if (command.args[0] === "branch" && command.args[1]?.startsWith("--format")) {
				branchReads += 1;
				if (branchReads === 1) {
					return new Promise<Result<ShellOutput>>((resolve) => {
						releaseFirst = () => resolve(ok(output("old\n")));
					});
				}
				return ok(output("new\n"));
			}
			if (command.args[0] === "for-each-ref") return ok(output(""));
			if (command.args[0] === "worktree") return ok(output("worktree /repo\nHEAD aaa\n"));
			return err(appError("git_unscripted", "unexpected"));
		});
		const service = makeService(h.runner);

		const slow = service.refreshBranches(repoRoot, "origin");
		const fast = service.refreshBranches(repoRoot, "origin");
		await fast;
		releaseFirst?.();
		await slow;

		expect(service.branchesOf(repoRoot)?.branches?.local).toEqual(["new"]);
	});

	it("polls the foreground repository every 5 seconds and stops on unsubscribe", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(start);
		const h = harness(branchListAnswer("main\n", "origin/main\n", "worktree /repo\nHEAD aaa\n"));
		// The poller judges staleness by the injected clock, so it must move with the fake timers.
		const service = makeService(h.runner, { now: () => Date.now() });
		const firstUpdate = nextBranchUpdate(service);
		const stop = service.watchBranches(repoRoot, "origin", "foreground");
		await firstUpdate;
		expect(h.commands.filter((command) => command.args[0] === "branch")).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(0);

		const secondUpdate = nextBranchUpdate(service);
		await vi.advanceTimersByTimeAsync(BRANCH_POLL_INTERVAL_MS);
		await secondUpdate;
		expect(h.commands.filter((command) => command.args[0] === "branch")).toHaveLength(2);

		stop();
		await vi.advanceTimersByTimeAsync(BRANCH_POLL_INTERVAL_MS * 4);
		expect(h.commands.filter((command) => command.args[0] === "branch")).toHaveLength(2);
	});

	it("polls another repository every 60 seconds", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(start);
		const h = harness(branchListAnswer("main\n", "origin/main\n", "worktree /repo\nHEAD aaa\n"));
		// The poller judges staleness by the injected clock, so it must move with the fake timers.
		const service = makeService(h.runner, { now: () => Date.now() });
		const firstUpdate = nextBranchUpdate(service);
		const stop = service.watchBranches(repoRoot, "origin", "background");
		await firstUpdate;
		expect(h.commands.filter((command) => command.args[0] === "branch")).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(0);

		await vi.advanceTimersByTimeAsync(BRANCH_POLL_INTERVAL_MS);
		expect(h.commands.filter((command) => command.args[0] === "branch")).toHaveLength(1);

		const secondUpdate = nextBranchUpdate(service);
		await vi.advanceTimersByTimeAsync(BRANCH_BACKGROUND_POLL_INTERVAL_MS - BRANCH_POLL_INTERVAL_MS);
		await secondUpdate;
		expect(h.commands.filter((command) => command.args[0] === "branch")).toHaveLength(2);
		stop();
	});

	it("keeps a branch read failure in the store and returns it", async () => {
		const h = harness((command) => {
			if (command.args[0] === "worktree") return ok(output(""));
			return err(appError("git_failed", "git could not read the branches."));
		});
		const service = makeService(h.runner);

		const result = await service.refreshBranches(repoRoot, "origin");

		expect(result).toEqual(err(appError("git_failed", "git could not read the branches.")));
		expect(service.branchesOf(repoRoot)?.error).toEqual({
			code: "git_failed",
			message: "git could not read the branches.",
		});
	});
});

describe("GIT-12 branch commits", () => {
	it("stores each branch commit with its message, hash, author and date", async () => {
		const h = harness((command) => {
			const poll = pollAnswer(command, "feat");
			if (poll !== null) return poll;
			if (command.args[0] === "log") {
				return ok(
					output("abc1234567890\x1fAdd the changes list\x1fAda\x1fada@example.com\x1f1700000000\n"),
				);
			}
			return err(appError("git_unscripted", "unexpected"));
		});
		const service = makeService(h.runner);

		await service.refresh(workspaceId, "full");

		expect(service.store.getState().byWorkspace[workspaceId]?.snapshot?.commits).toEqual([
			{
				hash: "abc1234567890",
				subject: "Add the changes list",
				authorName: "Ada",
				authorEmail: "ada@example.com",
				authoredAt: 1_700_000_000,
			},
		]);
	});
});

describe("GIT-12 switch branch", () => {
	function switchAnswer(
		options: {
			fetchExit?: number;
			head?: string;
			localExists?: boolean;
			ancestorExit?: number;
			mergeExit?: number;
		} = {},
	): (command: GitCommand) => Result<ShellOutput> {
		return (command) => {
			const args = command.args;
			if (args[0] === "fetch") return ok(output("", "", options.fetchExit ?? 0));
			if (args[0] === "show-ref") {
				return ok(output("", "", options.localExists === false ? 1 : 0));
			}
			if (args[0] === "checkout") return ok(output(""));
			if (args[0] === "symbolic-ref")
				return ok(output(`${options.head ?? "refs/heads/feature"}\n`));
			if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
				return ok(output("", "", options.ancestorExit ?? 0));
			}
			if (args[0] === "merge") return ok(output("", "", options.mergeExit ?? 0));
			if (args[0] === "log") return ok(output(""));
			return pollAnswer(command, "feature") ?? err(appError("git_unscripted", "unexpected"));
		};
	}

	it("fetches, checks out and fast-forwards the branch", async () => {
		const h = harness(switchAnswer());
		const service = makeService(h.runner, { renamedTo: h.renamedTo });

		const result = await service.switchBranch(workspaceId, "feature");

		expect(result).toEqual(ok(undefined));
		expect(h.fetches[0]?.args).toEqual([
			"fetch",
			"--no-write-fetch-head",
			"--prune",
			"--",
			"origin",
			"+refs/heads/feature:refs/remotes/origin/feature",
		]);
		expect(h.checkouts[0]?.args).toEqual(["checkout", "feature"]);
		expect(h.merges[0]?.args).toEqual(["merge", "--ff-only", "refs/remotes/origin/feature"]);
		expect(h.renamedTo).toEqual(["feature"]);
	});

	it("checks out a remote branch by its bare name", async () => {
		const h = harness(switchAnswer());
		const service = makeService(h.runner);

		expect(await service.switchBranch(workspaceId, "origin/feature")).toEqual(ok(undefined));

		expect(h.checkouts[0]?.args).toEqual(["checkout", "feature"]);
	});

	it("checks out without merging when the branch has diverged", async () => {
		const h = harness(switchAnswer({ ancestorExit: 1 }));
		const service = makeService(h.runner);

		expect(await service.switchBranch(workspaceId, "feature")).toEqual(ok(undefined));

		expect(h.checkouts).toHaveLength(1);
		expect(h.merges).toHaveLength(0);
	});

	it("returns git's failed fast-forward", async () => {
		const h = harness(switchAnswer({ mergeExit: 1 }));
		const service = makeService(h.runner);

		const result = await service.switchBranch(workspaceId, "feature");

		expect(result.ok).toBe(false);
	});

	it("checks out a local branch when the fetch fails", async () => {
		const h = harness(switchAnswer({ fetchExit: 128, localExists: true }));
		const service = makeService(h.runner);

		expect(await service.switchBranch(workspaceId, "feature")).toEqual(ok(undefined));

		expect(h.checkouts[0]?.args).toEqual(["checkout", "feature"]);
	});

	it("refuses a branch that exists only on the remote when the fetch fails", async () => {
		const h = harness(switchAnswer({ fetchExit: 128, localExists: false }));
		const service = makeService(h.runner);

		const result = await service.switchBranch(workspaceId, "feature");

		expect(result.ok).toBe(false);
		expect(h.checkouts).toHaveLength(0);
	});

	it("refuses a name git could read as an option and runs nothing", async () => {
		const h = harness(switchAnswer());
		const service = makeService(h.runner);

		const result = await service.switchBranch(workspaceId, "--upload-pack=evil");

		expect(result).toEqual(
			err(
				appError(
					"workspace_branch_invalid",
					'"--upload-pack=evil" can\'t be used as a Git branch name.',
				),
			),
		);
		expect(h.commands).toHaveLength(0);
	});

	it("runs two switches one after the other, never at the same time", async () => {
		let fetchStarted = 0;
		let releaseFirst: (() => void) | undefined;
		let markFirstStarted: (() => void) | undefined;
		const firstStarted = new Promise<void>((resolve) => {
			markFirstStarted = resolve;
		});
		const h = harness((command) => {
			if (command.args[0] === "fetch") {
				fetchStarted += 1;
				if (fetchStarted === 1) {
					markFirstStarted?.();
					return new Promise<Result<ShellOutput>>((resolve) => {
						releaseFirst = () => resolve(ok(output("")));
					});
				}
				return ok(output(""));
			}
			return switchAnswer()(command);
		});
		const service = makeService(h.runner);

		const first = service.switchBranch(workspaceId, "feature");
		const second = service.switchBranch(workspaceId, "feature");
		await firstStarted;
		expect(fetchStarted).toBe(1);

		releaseFirst?.();
		await Promise.all([first, second]);
		expect(fetchStarted).toBe(2);
	});
});
