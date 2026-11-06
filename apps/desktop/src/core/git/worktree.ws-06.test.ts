import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "./commands.ts";
import {
	addWorktreeOnBranch,
	readBranchState,
	restoreArchiveCheckpoint,
	worktreeBranches,
} from "./worktree.ts";

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

const sameArgs = (command: GitCommand, args: readonly string[]): boolean =>
	command.program === "git" &&
	command.args.length === args.length &&
	args.every((arg, index) => command.args[index] === arg);

describe("WS-06 reading the archived branch", () => {
	it("reports the branch, its tip and that it is checked out elsewhere", async () => {
		const git = new FakeGitRunner((command) => {
			if (sameArgs(command, ["show-ref", "--verify", "--quiet", "refs/heads/feature/oslo"])) {
				return ok(output(0));
			}
			if (sameArgs(command, ["rev-parse", "refs/heads/feature/oslo"])) {
				return ok(output(0, "tip-1\n"));
			}
			if (sameArgs(command, ["worktree", "list", "--porcelain"])) {
				return ok(output(0, "worktree /worktrees/other\nbranch refs/heads/feature/oslo\n"));
			}
			return ok(output(0));
		});

		const state = await readBranchState(git, "/repo", "feature/oslo");

		expect(state).toEqual({
			ok: true,
			value: { exists: true, tip: "tip-1", checkedOutElsewhere: true },
		});
	});

	it("reports a deleted branch without a tip and not checked out", async () => {
		const git = new FakeGitRunner((command) => {
			if (sameArgs(command, ["show-ref", "--verify", "--quiet", "refs/heads/gone"])) {
				return ok(output(1));
			}
			return ok(output(0));
		});

		const state = await readBranchState(git, "/repo", "gone");

		expect(state).toEqual({
			ok: true,
			value: { exists: false, tip: null, checkedOutElsewhere: false },
		});
	});

	it("reads every branch from the porcelain worktree list", () => {
		const text = [
			"worktree /repo",
			"HEAD abc",
			"branch refs/heads/main",
			"",
			"worktree /worktrees/one",
			"HEAD def",
			"branch refs/heads/feature/one",
			"",
			"worktree /worktrees/two",
			"HEAD 123",
			"detached",
			"",
		].join("\n");

		expect(worktreeBranches(text)).toEqual(["refs/heads/main", "refs/heads/feature/one"]);
	});
});

describe("WS-06 adding the worktree", () => {
	it("adds a worktree on an existing branch without creating a branch", async () => {
		const git = new FakeGitRunner(() => ok(output(0)));

		const added = await addWorktreeOnBranch(git, {
			repoRootPath: "/repo",
			worktreePath: "/worktrees/oslo",
			branch: "feature/oslo",
			createFrom: null,
		});

		expect(added.ok).toBe(true);
		expect(git.commands.map((command) => command.args)).toEqual([
			["worktree", "add", "/worktrees/oslo", "feature/oslo"],
		]);
		expect(git.calls[0]?.options.cwd).toBe("/repo");
	});

	it("creates the branch from the archive commit, then adds its worktree", async () => {
		const git = new FakeGitRunner(() => ok(output(0)));

		const added = await addWorktreeOnBranch(git, {
			repoRootPath: "/repo",
			worktreePath: "/worktrees/oslo",
			branch: "feature/oslo",
			createFrom: "archive-sha",
		});

		expect(added.ok).toBe(true);
		expect(git.commands.map((command) => command.args)).toEqual([
			["branch", "--", "feature/oslo", "archive-sha"],
			["worktree", "add", "/worktrees/oslo", "feature/oslo"],
		]);
	});
});

describe("WS-06 restoring the archive checkpoint", () => {
	it("runs the checkpointer restore under the archive checkpoint id", async () => {
		const git = new FakeGitRunner(() => ok(output(0)));

		const restored = await restoreArchiveCheckpoint(
			git,
			"/res/bin/checkpointer.sh",
			"w1",
			"/worktrees/oslo",
		);

		expect(restored.ok).toBe(true);
		expect(git.calls[0]?.command.program).toBe("/res/bin/checkpointer.sh");
		expect(git.calls[0]?.command.args).toEqual(["restore", "archive-w1"]);
		expect(git.calls[0]?.options.cwd).toBe("/worktrees/oslo");
	});

	it("returns the checkpointer's refusal as an error", async () => {
		const git = new FakeGitRunner((command) =>
			command.program === "/res/bin/checkpointer.sh"
				? ok(output(1, "", "the saved state is gone"))
				: ok(output(0)),
		);

		const restored = await restoreArchiveCheckpoint(
			git,
			"/res/bin/checkpointer.sh",
			"w1",
			"/worktrees/oslo",
		);

		expect(restored).toMatchObject({
			ok: false,
			error: { code: "archive_restore_failed", message: "the saved state is gone" },
		});
	});
});
