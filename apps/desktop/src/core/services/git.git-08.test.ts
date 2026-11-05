/**
 * @feature GIT-08 Change the target branch
 * Owns: tests for storing the intended target branch, moving an open pull request's base, and the
 * local fetch and reset, plus the "Target branch" diff scope.
 * Behaviour: services-map.md 3.11 (retarget), 2.3.1 (set intended target branch), ui-map.md 3.6.
 * Test first: a clean branch still at its old target is fetched and reset to the new target.
 */
import { readFile } from "node:fs/promises";
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import { resetHard } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import { GitService, type WorkspaceGitContext } from "./git.ts";

const workspaceId = "workspace-1" as WorkspaceId;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

interface RunnerOptions {
	status?: string;
	head?: string;
	refs?: Record<string, boolean>;
	fetchFails?: boolean;
	resetFails?: boolean;
}

function fakeRunner(options: RunnerOptions = {}): {
	git: GitRunner;
	commands: GitCommand[];
} {
	const commands: GitCommand[] = [];

	const reply = (command: GitCommand): ShellOutput => {
		commands.push(command);
		const [first, second] = command.args;
		if (first === "fetch") {
			return options.fetchFails ? output("", "fatal: couldn't find remote ref", 1) : output();
		}
		if (first === "status" && second === "--porcelain=v1") return output(options.status ?? "");
		if (first === "show-ref") {
			const ref = command.args.at(-1) ?? "";
			const exists = options.refs?.[ref] ?? true;
			return output("", "", exists ? 0 : 1);
		}
		if (first === "rev-parse" && second === "HEAD") return output(`${options.head ?? "old-sha"}\n`);
		if (first === "rev-parse") return output("old-sha\n");
		if (first === "reset") {
			return options.resetFails ? output("", "fatal: could not reset", 1) : output();
		}
		if (first === "merge-base") return output("merge-base-of-release\n");
		return output();
	};

	const run = async (command: GitCommand): Promise<Result<ShellOutput>> => ok(reply(command));
	const runChecked = async (
		command: GitCommand,
		_options: GitRunOptions,
	): Promise<Result<ShellOutput>> => {
		const result = await run(command);
		if (!result.ok) return result;
		const codes = command.okExitCodes ?? [0];
		return codes.includes(result.value.exitCode)
			? result
			: err(appError("git_failed", result.value.stderr.trim() || "git failed"));
	};
	const stdout = async (command: GitCommand): Promise<Result<string>> => {
		const result = await runChecked(command, { cwd: "/wt" });
		return result.ok ? ok(result.value.stdout.trim()) : result;
	};

	return {
		commands,
		git: {
			run,
			runChecked,
			stdout,
			start: async () => {
				throw new Error("start is not used");
			},
			withWorktreeLock: (_path, work) => work(),
			withWorktreeAndRepoLocks: (_path, _root, work) => work(),
		},
	};
}

const context: WorkspaceGitContext = {
	workspaceId,
	workspacePath: "/wt",
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feat",
};

interface ServiceOptions {
	stored?: { id: WorkspaceId; branch: string }[];
	moved?: (id: WorkspaceId, branch: string) => Promise<Result<boolean>>;
	storeResult?: Result<void>;
}

function makeService(
	git: GitRunner,
	options: ServiceOptions = {},
): { service: GitService; stored: { id: WorkspaceId; branch: string }[] } {
	const stored = options.stored ?? [];
	const service = new GitService({
		git,
		cache: {} as never,
		contextOf: async () => ok(context),
		agent: {} as never,
		now: () => 0,
		fs: {
			trash: async () => ok(undefined),
			readText: async () => err(appError("fs_not_found", "missing")),
			writeTextAtomic: async () => ok(undefined),
			mkdirp: async () => ok(undefined),
			stat: async () => err(appError("fs_not_found", "missing")),
			paths: { home: "", appData: "", temp: "", resources: "" },
		},
		setIntendedTargetBranch: async (id, branch) => {
			if (options.storeResult !== undefined && !options.storeResult.ok) return options.storeResult;
			stored.push({ id, branch });
			return ok(undefined);
		},
		moveOpenPullRequestBase: options.moved ?? (async () => ok(false)),
	});
	return { service, stored };
}

const hasCommand = (commands: readonly GitCommand[], first: string): boolean =>
	commands.some((command) => command.args[0] === first);

describe("GIT-08 change the target branch", () => {
	it("fetches the new target and resets a clean branch still at the old target", async () => {
		const { git, commands } = fakeRunner();
		const { service, stored } = makeService(git);

		const result = await service.setTargetBranch(workspaceId, "develop");

		expect(result.ok).toBe(true);
		expect(stored).toEqual([{ id: workspaceId, branch: "develop" }]);
		expect(commands).toContainEqual(
			expect.objectContaining({
				args: [
					"fetch",
					"--no-write-fetch-head",
					"--prune",
					"--",
					"origin",
					"+refs/heads/develop:refs/remotes/origin/develop",
				],
			}),
		);
		const fetchAt = commands.findIndex((command) => command.args[0] === "fetch");
		const resetAt = commands.findIndex((command) => command.args[0] === "reset");
		expect(fetchAt).toBeGreaterThanOrEqual(0);
		expect(resetAt).toBeGreaterThan(fetchAt);
		expect(commands[resetAt]?.args).toEqual(["reset", "--hard", "refs/remotes/origin/develop"]);
	});

	it("does not reset when the worktree has changes, but still fetches and stores the target", async () => {
		const { git, commands } = fakeRunner({ status: " M src/a.ts\n" });
		const { service, stored } = makeService(git);

		const result = await service.setTargetBranch(workspaceId, "develop");

		expect(result.ok).toBe(true);
		expect(stored).toEqual([{ id: workspaceId, branch: "develop" }]);
		expect(hasCommand(commands, "fetch")).toBe(true);
		expect(hasCommand(commands, "reset")).toBe(false);
	});

	it("does not reset when HEAD is not at the old target", async () => {
		const { git, commands } = fakeRunner({ head: "new-work-sha" });
		const { service, stored } = makeService(git);

		const result = await service.setTargetBranch(workspaceId, "develop");

		expect(result.ok).toBe(true);
		expect(stored).toEqual([{ id: workspaceId, branch: "develop" }]);
		expect(hasCommand(commands, "reset")).toBe(false);
	});

	it("does not reset when the new target ref does not resolve after the fetch", async () => {
		const { git, commands } = fakeRunner({
			refs: { "refs/remotes/origin/develop": false },
		});
		const { service, stored } = makeService(git);

		const result = await service.setTargetBranch(workspaceId, "develop");

		expect(result.ok).toBe(true);
		expect(stored).toEqual([{ id: workspaceId, branch: "develop" }]);
		expect(hasCommand(commands, "fetch")).toBe(true);
		expect(hasCommand(commands, "reset")).toBe(false);
	});

	it("moves an open pull request's base instead of fetching or resetting", async () => {
		const { git, commands } = fakeRunner();
		const moved: { id: WorkspaceId; branch: string }[] = [];
		const { service, stored } = makeService(git, {
			moved: async (id, branch) => {
				moved.push({ id, branch });
				return ok(true);
			},
		});

		const result = await service.setTargetBranch(workspaceId, "origin/develop");

		expect(result.ok).toBe(true);
		expect(moved).toEqual([{ id: workspaceId, branch: "develop" }]);
		expect(stored).toEqual([{ id: workspaceId, branch: "origin/develop" }]);
		expect(hasCommand(commands, "fetch")).toBe(false);
		expect(hasCommand(commands, "reset")).toBe(false);
	});

	it("returns a failed fetch and does not reset", async () => {
		const { git, commands } = fakeRunner({ fetchFails: true });
		const { service, stored } = makeService(git);

		const result = await service.setTargetBranch(workspaceId, "develop");

		expect(result.ok).toBe(false);
		expect(stored).toEqual([{ id: workspaceId, branch: "develop" }]);
		expect(hasCommand(commands, "reset")).toBe(false);
	});

	it("refuses a branch git could read as an option", async () => {
		const { git, commands } = fakeRunner();
		const { service, stored } = makeService(git);

		const result = await service.setTargetBranch(workspaceId, "--upload-pack=x");

		expect(result.ok).toBe(false);
		expect(stored).toEqual([]);
		expect(commands).toEqual([]);
	});

	it("sets the target from the agent after checking the remote ref, without fetch or reset", async () => {
		const { git, commands } = fakeRunner();
		const { service, stored } = makeService(git);

		const result = await service.setTargetBranchFromAgent(workspaceId, "develop");

		expect(result.ok).toBe(true);
		expect(stored).toEqual([{ id: workspaceId, branch: "develop" }]);
		expect(commands).toContainEqual(
			expect.objectContaining({
				args: ["show-ref", "--verify", "--quiet", "refs/remotes/origin/develop"],
			}),
		);
		expect(hasCommand(commands, "fetch")).toBe(false);
		expect(hasCommand(commands, "reset")).toBe(false);
	});

	it("refuses an agent target that is not on the remote and stores nothing", async () => {
		const { git } = fakeRunner({ refs: { "refs/remotes/origin/develop": false } });
		const { service, stored } = makeService(git);

		const result = await service.setTargetBranchFromAgent(workspaceId, "develop");

		expect(result.ok).toBe(false);
		expect(stored).toEqual([]);
	});

	it("compares the Target branch diff scope against the chosen branch", async () => {
		const { git, commands } = fakeRunner();
		const { service } = makeService(git);

		const resolved = await service.resolveScope(workspaceId, {
			kind: "target",
			branch: "release/1",
		});

		expect(resolved.ok).toBe(true);
		if (resolved.ok) expect(resolved.value.from).toBe("merge-base-of-release");
		expect(commands).toContainEqual(
			expect.objectContaining({
				args: ["merge-base", "refs/remotes/origin/release/1", "feat"],
			}),
		);
	});

	it("is the only reset in the command catalogue, and it is a hard reset", async () => {
		const resetLiterals = (source: string): number => (source.match(/"reset"/g) ?? []).length;
		const sample = 'a(["reset", "--soft", "x"]); b(["reset", "--mixed", "y"])';
		expect(resetLiterals(sample)).toBe(2);

		expect(resetHard("refs/remotes/origin/develop").args).toEqual([
			"reset",
			"--hard",
			"refs/remotes/origin/develop",
		]);
		const source = await readFile(new URL("../git/commands.ts", import.meta.url), "utf8");
		expect(resetLiterals(source)).toBe(1);
	});
});
