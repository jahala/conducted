import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "./commands.ts";
import { type GitRunner, isSuccessfulExit } from "./runner.ts";
import { removeWorktree, saveArchiveSnapshot } from "./worktree.ts";

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

function makeRunner(reply: (command: GitCommand, cwd: string) => ShellOutput | undefined): {
	git: GitRunner;
	calls: { command: GitCommand; cwd: string }[];
} {
	const calls: { command: GitCommand; cwd: string }[] = [];
	const run: GitRunner["run"] = async (command, options) => {
		calls.push({ command, cwd: options.cwd });
		return ok(reply(command, options.cwd) ?? output(0));
	};
	const runChecked: GitRunner["runChecked"] = async (command, options) => {
		const result = await run(command, options);
		if (!result.ok) return result;
		return isSuccessfulExit(command, result.value.exitCode)
			? result
			: err(appError("git_failed", result.value.stderr.trim() || "git failed"));
	};
	const stdout: GitRunner["stdout"] = async (command, options) => {
		const result = await runChecked(command, options);
		return result.ok ? ok(result.value.stdout.trim()) : result;
	};
	return {
		calls,
		git: {
			run,
			runChecked,
			stdout,
			async start() {
				throw new Error("start is not used in these tests");
			},
			async withWorktreeLock(_path, work) {
				return work();
			},
			async withWorktreeAndRepoLocks(_worktree, _root, work) {
				return work();
			},
		},
	};
}

function makeFs(overrides: Partial<FileSystem> = {}): {
	fs: FileSystem;
	trashed: string[];
} {
	const trashed: string[] = [];
	const fs = {
		async readText(): Promise<Result<string>> {
			return err(appError("fs_not_found", "missing"));
		},
		async writeTextAtomic(): Promise<Result<void>> {
			return ok(undefined);
		},
		async exists() {
			return false;
		},
		async stat() {
			return err(appError("fs_not_found", "missing"));
		},
		async mkdirp() {
			return ok(undefined);
		},
		async readDir() {
			return ok([]);
		},
		async trash(path: string) {
			trashed.push(path);
			return ok(undefined);
		},
		paths: { home: "/Users/test", appData: "/app", temp: "/tmp", resources: "/res" },
		...overrides,
	} satisfies FileSystem;
	return { fs, trashed };
}

const sameArgs = (command: GitCommand, args: readonly string[]): boolean =>
	command.program === "git" &&
	command.args.length === args.length &&
	args.every((arg, index) => command.args[index] === arg);

describe("WS-05 archive snapshot", () => {
	it("saves the worktree under the archive checkpoint id", async () => {
		const { git, calls } = makeRunner(() => output(0));
		const { fs } = makeFs();

		const saved = await saveArchiveSnapshot(git, {
			workspaceId: "w1",
			checkpointerPath: "/res/bin/checkpointer.sh",
			worktreePath: "/worktrees/oslo",
			discardGitOperationState: false,
			fs,
		});

		expect(saved).toEqual(ok({ discarded: false }));
		expect(calls[0]?.command.program).toBe("/res/bin/checkpointer.sh");
		expect(calls[0]?.command.args).toEqual(["save", "--id", "archive-w1", "--force"]);
		expect(calls[0]?.cwd).toBe("/worktrees/oslo");
	});

	it("refuses a busy checkout until the caller asks to discard its operation state", async () => {
		const { git, calls } = makeRunner((command) =>
			command.program === "/res/bin/checkpointer.sh" ? output(101) : undefined,
		);
		const { fs, trashed } = makeFs();

		const saved = await saveArchiveSnapshot(git, {
			workspaceId: "w1",
			checkpointerPath: "/res/bin/checkpointer.sh",
			worktreePath: "/worktrees/oslo",
			discardGitOperationState: false,
			fs,
		});

		expect(saved.ok).toBe(false);
		if (!saved.ok) expect(saved.error.code).toBe("archive_git_busy");
		expect(trashed).toEqual([]);
		expect(calls.some((call) => call.command.args.includes("-u"))).toBe(false);
	});

	it("discards unmerged paths and operation files, then retries the save once", async () => {
		let saves = 0;
		const { git, calls } = makeRunner((command, cwd) => {
			if (command.program === "/res/bin/checkpointer.sh") {
				saves += 1;
				return output(saves === 1 ? 102 : 0);
			}
			if (sameArgs(command, ["diff", "--name-only", "--diff-filter=U", "-z"])) {
				return output(0, "src/a.ts\0src/b.ts\0");
			}
			if (sameArgs(command, ["rev-parse", "--git-path", "MERGE_HEAD"])) {
				return output(0, `${cwd}/.git/MERGE_HEAD`);
			}
			return undefined;
		});
		const { fs, trashed } = makeFs({
			async exists(path: string) {
				return path === "/worktrees/oslo/.git/MERGE_HEAD";
			},
		});

		const saved = await saveArchiveSnapshot(git, {
			workspaceId: "w1",
			checkpointerPath: "/res/bin/checkpointer.sh",
			worktreePath: "/worktrees/oslo",
			discardGitOperationState: true,
			fs,
		});

		expect(saved).toEqual(ok({ discarded: true }));
		expect(
			calls.some((call) => sameArgs(call.command, ["add", "-u", "--", "src/a.ts", "src/b.ts"])),
		).toBe(true);
		expect(trashed).toEqual(["/worktrees/oslo/.git/MERGE_HEAD"]);
		expect(saves).toBe(2);
	});
});

describe("WS-05 removeWorktree", () => {
	it("removes the worktree through git", async () => {
		const { git, calls } = makeRunner((command) =>
			sameArgs(command, ["worktree", "remove", "--force", "--force", "/worktrees/oslo"])
				? output(0)
				: undefined,
		);
		const { fs, trashed } = makeFs();

		const removed = await removeWorktree(git, fs, {
			repoRootPath: "/repo",
			worktreePath: "/worktrees/oslo",
		});

		expect(removed.ok).toBe(true);
		expect(trashed).toEqual([]);
		expect(calls.some((call) => sameArgs(call.command, ["worktree", "prune"]))).toBe(false);
	});

	it("trashes the folder and prunes the worktree list when git refuses", async () => {
		const { git, calls } = makeRunner((command) =>
			sameArgs(command, ["worktree", "remove", "--force", "--force", "/worktrees/oslo"])
				? output(1, "", "not a working tree")
				: undefined,
		);
		const { fs, trashed } = makeFs({
			async exists() {
				return true;
			},
		});

		const removed = await removeWorktree(git, fs, {
			repoRootPath: "/repo",
			worktreePath: "/worktrees/oslo",
		});

		expect(removed.ok).toBe(true);
		expect(trashed).toEqual(["/worktrees/oslo"]);
		expect(calls.some((call) => sameArgs(call.command, ["worktree", "prune"]))).toBe(true);
	});
});
