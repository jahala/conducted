/**
 * @feature GIT-09 Rename the branch
 * Owns: tests for the branch-name availability rule, the pull request check, and the locked
 * `git branch -m` step.
 * Test first: a name with an open pull request becomes name-v2.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "./commands.ts";
import {
	branchNameTaken,
	freeBranchName,
	NO_BRANCH_CHECKED_OUT_MESSAGE,
	nextFreeBranchName,
	renameBranchInWorktree,
} from "./rename.ts";
import type { GitRunner, GitRunOptions } from "./runner.ts";

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

function fakeRunner(
	handler: (command: GitCommand, options: GitRunOptions) => Result<ShellOutput>,
): GitRunner {
	const run = async (command: GitCommand, options: GitRunOptions) => handler(command, options);
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
		run,
		runChecked,
		stdout,
		start: async () => {
			throw new Error("start is not used by the rename rules");
		},
		withWorktreeLock: (_worktreePath, work) => work(),
		withWorktreeAndRepoLocks: (_worktreePath, _repoRootPath, work) => work(),
	};
}

const takenBy = (names: readonly string[]) => async (candidate: string) =>
	ok(names.includes(candidate));

describe("GIT-09 branch name availability", () => {
	it("keeps a free name as it is", async () => {
		const result = await nextFreeBranchName("fix-login", takenBy([]));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toBe("fix-login");
	});

	it("starts the suffix at -v2 and moves on while names are taken", async () => {
		const result = await nextFreeBranchName("fix-login", takenBy(["fix-login", "fix-login-v2"]));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toBe("fix-login-v3");
	});

	it("bumps an existing -vN suffix instead of appending another one", async () => {
		const result = await nextFreeBranchName("fix-login-v4", takenBy(["fix-login-v4"]));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toBe("fix-login-v5");
	});

	it("returns an error when the availability check itself fails", async () => {
		const result = await nextFreeBranchName("fix-login", async () =>
			err(appError("git_failed", "show-ref failed")),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("git_failed");
	});
});

describe("GIT-09 branch name taken", () => {
	it("reports a local branch", async () => {
		const git = fakeRunner((command) =>
			command.args[0] === "show-ref" ? ok(output("", "", 0)) : ok(output("")),
		);
		const result = await branchNameTaken(git, {
			repoRootPath: "/repo",
			remote: "origin",
			name: "fix-login",
		});
		expect(result.ok && result.value).toBe(true);
	});

	it("reports a remote-tracking branch", async () => {
		let calls = 0;
		const git = fakeRunner((command) => {
			if (command.args[0] !== "show-ref") return ok(output(""));
			calls += 1;
			return ok(output("", "", calls === 1 ? 1 : 0));
		});
		const result = await branchNameTaken(git, {
			repoRootPath: "/repo",
			remote: "origin",
			name: "fix-login",
		});
		expect(result.ok && result.value).toBe(true);
	});

	it("reports an open pull request on a GitHub remote", async () => {
		const git = fakeRunner((command) => {
			if (command.args[0] === "show-ref") return ok(output("", "", 1));
			if (command.args[0] === "remote") return ok(output("git@github.com:acme/app.git\n"));
			if (command.args[0] === "pr") return ok(output('[{"state":"OPEN"}]\n'));
			return err(appError("git_failed", "unexpected"));
		});
		const result = await branchNameTaken(git, {
			repoRootPath: "/repo",
			remote: "origin",
			name: "fix-login",
		});
		expect(result.ok && result.value).toBe(true);
	});

	it("does not run the pull request check for a remote that is not GitHub", async () => {
		let askedGh = false;
		const git = fakeRunner((command) => {
			if (command.args[0] === "show-ref") return ok(output("", "", 1));
			if (command.args[0] === "remote") return ok(output("git@example.com:acme/app.git\n"));
			if (command.args[0] === "pr") askedGh = true;
			return ok(output(""));
		});
		const result = await branchNameTaken(git, {
			repoRootPath: "/repo",
			remote: "origin",
			name: "fix-login",
		});
		expect(result.ok && result.value).toBe(false);
		expect(askedGh).toBe(false);
	});

	it("does not treat a host that merely contains github.com as GitHub", async () => {
		let askedGh = false;
		const git = fakeRunner((command) => {
			if (command.args[0] === "show-ref") return ok(output("", "", 1));
			if (command.args[0] === "remote") return ok(output("git@evilgithub.com:acme/app.git\n"));
			if (command.args[0] === "pr") askedGh = true;
			return ok(output(""));
		});
		const result = await branchNameTaken(git, {
			repoRootPath: "/repo",
			remote: "origin",
			name: "fix-login",
		});
		expect(result.ok && result.value).toBe(false);
		expect(askedGh).toBe(false);
	});

	it("runs the pull request check for GitHub's SSH host", async () => {
		let askedGh = false;
		const git = fakeRunner((command) => {
			if (command.args[0] === "show-ref") return ok(output("", "", 1));
			if (command.args[0] === "remote")
				return ok(output("ssh://git@ssh.github.com:443/acme/app\n"));
			if (command.args[0] === "pr") {
				askedGh = true;
				return ok(output("[]"));
			}
			return err(appError("git_failed", "unexpected"));
		});
		const result = await branchNameTaken(git, {
			repoRootPath: "/repo",
			remote: "origin",
			name: "fix-login",
		});
		expect(result.ok && result.value).toBe(false);
		expect(askedGh).toBe(true);
	});

	it("returns a failed gh call instead of reading it as no pull request", async () => {
		const git = fakeRunner((command) => {
			if (command.args[0] === "show-ref") return ok(output("", "", 1));
			if (command.args[0] === "remote") return ok(output("git@github.com:acme/app.git\n"));
			if (command.args[0] === "pr") return ok(output("", "gh: not signed in", 4));
			return err(appError("git_failed", "unexpected"));
		});
		const result = await branchNameTaken(git, {
			repoRootPath: "/repo",
			remote: "origin",
			name: "fix-login",
		});
		expect(result.ok).toBe(false);
	});

	it("gives a free branch name through the whole check", async () => {
		const git = fakeRunner((command) => {
			if (command.args[0] === "show-ref") {
				return ok(output("", "", command.args.at(-1) === "refs/heads/fix-login" ? 0 : 1));
			}
			if (command.args[0] === "remote") return ok(output("git@example.com:acme/app.git\n"));
			return ok(output(""));
		});
		const result = await freeBranchName(git, {
			repoRootPath: "/repo",
			remote: "origin",
			base: "fix-login",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toBe("fix-login-v2");
	});
});

describe("GIT-09 locked branch rename", () => {
	it("names the plain message for a detached HEAD", () => {
		expect(NO_BRANCH_CHECKED_OUT_MESSAGE).toBe("Please check out a branch before renaming.");
	});

	it("reads, renames and saves under the worktree lock", async () => {
		const commands: GitCommand[] = [];
		const locks: string[] = [];
		const git = fakeRunner((command) => {
			commands.push(command);
			const [first, second] = command.args;
			if (first === "branch" && second === "--show-current") return ok(output("old\n"));
			if (first === "show-ref") return ok(output("", "", 1));
			if (first === "remote") return ok(output("git@example.com:acme/app.git\n"));
			return ok(output(""));
		});
		git.withWorktreeLock = async (path, work) => {
			locks.push(path);
			return work();
		};
		const saved: string[] = [];
		const result = await renameBranchInWorktree(git, {
			worktreePath: "/repo/worktree",
			repoRootPath: "/repo",
			remote: "origin",
			requestedName: "new",
			onRenamed: async (branch) => {
				saved.push(branch);
				return ok(undefined);
			},
		});
		expect(result.ok).toBe(true);
		expect(locks).toEqual(["/repo/worktree"]);
		expect(saved).toEqual(["new"]);
		expect(
			commands.find((command) => command.args[0] === "branch" && command.args[1] === "-m")?.args,
		).toEqual(["branch", "-m", "--", "old", "new"]);
	});

	it("returns the git failure and does not pretend the rename worked", async () => {
		const git = fakeRunner((command) => {
			const [first, second] = command.args;
			if (first === "branch" && second === "--show-current") return ok(output("old\n"));
			if (first === "show-ref") return ok(output("", "", 1));
			if (first === "remote") return ok(output("git@example.com:acme/app.git\n"));
			return ok(output("", "fatal: cannot rename", 128));
		});
		const saved: string[] = [];
		const result = await renameBranchInWorktree(git, {
			worktreePath: "/repo/worktree",
			repoRootPath: "/repo",
			remote: "origin",
			requestedName: "new",
			onRenamed: async (branch) => {
				saved.push(branch);
				return ok(undefined);
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toContain("cannot rename");
		expect(saved).toEqual([]);
	});
});
