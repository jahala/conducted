/**
 * @feature GIT-09 Rename the branch
 * Owns: tests for `GitService.renameBranch`: the detached-HEAD message, the free-name check, the
 * worktree lock, the save into the workspace, and the rollback when that save fails.
 * Test first: a rename saves the new branch in the workspace after `git branch -m`.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import { GitService, type WorkspaceGitContext } from "./git.ts";

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

const workspaceId = "workspace-1" as WorkspaceId;

const context = (over: Partial<WorkspaceGitContext> = {}): WorkspaceGitContext => ({
	workspaceId,
	workspacePath: "/repo/worktree",
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "old",
	...over,
});

function fakeRunner(
	handler: (command: GitCommand, options: GitRunOptions) => Result<ShellOutput>,
): GitRunner & { commands: GitCommand[]; locks: string[] } {
	const commands: GitCommand[] = [];
	const locks: string[] = [];
	const run = async (command: GitCommand, options: GitRunOptions) => {
		commands.push(command);
		return handler(command, options);
	};
	const runChecked = async (command: GitCommand, options: GitRunOptions) => {
		const result = await run(command, options);
		if (!result.ok) return result;
		const codes = command.okExitCodes ?? [0];
		return codes.includes(result.value.exitCode)
			? result
			: err(appError("git_failed", result.value.stderr.trim() || "git failed"));
	};
	const stdout = async (command: GitCommand, options: GitRunOptions) => {
		const result = await runChecked(command, options);
		return result.ok ? ok(result.value.stdout.trim()) : result;
	};
	return {
		commands,
		locks,
		run,
		runChecked,
		stdout,
		start: async () => {
			throw new Error("start is not used by rename");
		},
		withWorktreeLock: async (path, work) => {
			locks.push(path);
			return work();
		},
		withWorktreeAndRepoLocks: (_worktreePath, _repoRootPath, work) => work(),
	};
}

function makeService(
	runner: GitRunner,
	over: {
		contextOf?: (id: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
		renameWorkspaceBranch?: (id: WorkspaceId, branch: string) => Promise<Result<void>>;
	} = {},
): GitService {
	return new GitService({
		git: runner,
		cache: {} as never,
		contextOf: over.contextOf ?? (async () => ok(context())),
		agent: {} as never,
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
		renameWorkspaceBranch: over.renameWorkspaceBranch ?? (async () => ok(undefined)),
		now: () => 0,
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

const renameRunner = (
	current = "old",
	overrides: {
		localTaken?: readonly string[];
		remoteUrl?: string;
		prStates?: string;
		branchRenameExit?: number;
	} = {},
): ReturnType<typeof fakeRunner> =>
	fakeRunner((command) => {
		const [first, second] = command.args;
		if (first === "branch" && second === "--show-current") return ok(output(`${current}\n`));
		if (first === "show-ref") {
			const ref = command.args.at(-1) ?? "";
			const taken = (overrides.localTaken ?? []).some((name) => ref.endsWith(`/${name}`));
			return ok(output("", "", taken ? 0 : 1));
		}
		if (first === "remote")
			return ok(output(overrides.remoteUrl ?? "git@example.com:acme/app.git\n"));
		if (first === "pr") {
			const head = command.args[command.args.indexOf("--head") + 1];
			const states = head === "fix-login" ? (overrides.prStates ?? "[]") : "[]";
			return ok(output(`${states}\n`));
		}
		if (first === "branch" && second === "-m") {
			const exitCode = overrides.branchRenameExit ?? 0;
			return ok(output("", exitCode === 0 ? "" : "fatal: cannot rename", exitCode));
		}
		return err(appError("git_failed", `unexpected command: ${command.args.join(" ")}`));
	});

describe("GIT-09 GitService.renameBranch", () => {
	it("renames under the worktree lock and saves the new branch", async () => {
		const runner = renameRunner();
		const saved: string[] = [];
		const service = makeService(runner, {
			renameWorkspaceBranch: async (_id, branch) => {
				saved.push(branch);
				return ok(undefined);
			},
		});

		const result = await service.renameBranch(workspaceId, "  fix-login  ");

		expect(result.ok).toBe(true);
		expect(saved).toEqual(["fix-login"]);
		expect(runner.locks).toEqual(["/repo/worktree"]);
		const rename = runner.commands.find(
			(command) => command.args[0] === "branch" && command.args[1] === "-m",
		);
		expect(rename?.args).toEqual(["branch", "-m", "--", "old", "fix-login"]);
	});

	it("gives the plain message when no branch is checked out", async () => {
		const runner = renameRunner("");
		const saved: string[] = [];
		const service = makeService(runner, {
			renameWorkspaceBranch: async (_id, branch) => {
				saved.push(branch);
				return ok(undefined);
			},
		});

		const result = await service.renameBranch(workspaceId, "fix-login");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("git_no_branch_checked_out");
		expect(result.error.message).toBe("Please check out a branch before renaming.");
		expect(saved).toEqual([]);
		expect(
			runner.commands.some((command) => command.args[0] === "branch" && command.args[1] === "-m"),
		).toBe(false);
	});

	it("takes the next free name when the typed name is already used", async () => {
		const runner = renameRunner("old", { localTaken: ["fix-login"] });
		const saved: string[] = [];
		const service = makeService(runner, {
			renameWorkspaceBranch: async (_id, branch) => {
				saved.push(branch);
				return ok(undefined);
			},
		});

		const result = await service.renameBranch(workspaceId, "fix-login");

		expect(result.ok).toBe(true);
		expect(saved).toEqual(["fix-login-v2"]);
	});

	it("takes the next free name when a pull request already uses it", async () => {
		const runner = renameRunner("old", {
			remoteUrl: "git@github.com:acme/app.git\n",
			prStates: '[{"state":"MERGED"}]\n',
		});
		const saved: string[] = [];
		const service = makeService(runner, {
			renameWorkspaceBranch: async (_id, branch) => {
				saved.push(branch);
				return ok(undefined);
			},
		});

		const result = await service.renameBranch(workspaceId, "fix-login");

		expect(result.ok).toBe(true);
		expect(saved).toEqual(["fix-login-v2"]);
	});

	it("refuses a name git cannot read as a branch before running anything", async () => {
		const runner = renameRunner();
		const service = makeService(runner);

		const result = await service.renameBranch(workspaceId, "--output=/tmp/x");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("workspace_branch_invalid");
		expect(runner.commands).toEqual([]);
	});

	it("does nothing when the new name is the current branch", async () => {
		const runner = renameRunner("fix-login");
		const saved: string[] = [];
		const service = makeService(runner, {
			renameWorkspaceBranch: async (_id, branch) => {
				saved.push(branch);
				return ok(undefined);
			},
		});

		const result = await service.renameBranch(workspaceId, "fix-login");

		expect(result.ok).toBe(true);
		expect(saved).toEqual([]);
	});

	it("never deletes the old remote branch", async () => {
		const runner = renameRunner();
		const service = makeService(runner);

		await service.renameBranch(workspaceId, "fix-login");

		expect(
			runner.commands.some(
				(command) => command.args[0] === "branch" && command.args.includes("-D"),
			),
		).toBe(false);
		expect(runner.commands.some((command) => command.args[0] === "push")).toBe(false);
	});

	it("puts the branch back when the workspace cannot save the new name", async () => {
		const runner = renameRunner();
		const service = makeService(runner, {
			renameWorkspaceBranch: async () => err(appError("db_failed", "The row could not be saved.")),
		});

		const result = await service.renameBranch(workspaceId, "fix-login");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("The row could not be saved.");
		const renames = runner.commands.filter(
			(command) => command.args[0] === "branch" && command.args[1] === "-m",
		);
		expect(renames[1]?.args).toEqual(["branch", "-m", "--", "fix-login", "old"]);
	});

	it("returns a failed branch read instead of renaming", async () => {
		const runner = fakeRunner(() => err(appError("shell_timeout", "git took too long")));
		const service = makeService(runner);

		const result = await service.renameBranch(workspaceId, "fix-login");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("shell_timeout");
	});
});
