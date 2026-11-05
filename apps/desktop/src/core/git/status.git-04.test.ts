import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "./commands.ts";
import type { GitRunner, GitRunOptions } from "./runner.ts";
import { refreshWorkspaceChanges } from "./status.ts";

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
			throw new Error("start is not used by the changes pipeline");
		},
		withWorktreeLock: (_worktreePath, work) => work(),
		withWorktreeAndRepoLocks: (_worktreePath, _repoRootPath, work) => work(),
	};
}

const workspaceId = "workspace-1" as WorkspaceId;

interface PollOptions {
	/** The merge-base comparison, or the HEAD comparison for an uncommitted poll. */
	nameStatus: string;
	numstat: string;
	/** `git status --porcelain --untracked-files=no` output. */
	porcelain: string;
	/** NUL-separated `git ls-files --others` output. */
	untracked: string;
}

function pollRunner(options: PollOptions): GitRunner {
	return fakeRunner((command) => {
		const [first, second] = command.args;
		if (command.program === "stat") {
			const path = command.args.at(-1) ?? "";
			return ok(output("", "", path.startsWith("/git/") ? 1 : 0));
		}
		if (first === "branch" && second === "--show-current") return ok(output("feat\n"));
		if (first === "rev-parse" && second === "--git-path") {
			return ok(output(`/git/${command.args.at(-1)}\n`));
		}
		if (first === "merge-base") return ok(output("mb\n"));
		if (first === "diff" && command.args.includes("--name-status")) {
			return ok(output(options.nameStatus));
		}
		if (first === "diff" && command.args.includes("--numstat")) {
			return ok(output(options.numstat));
		}
		if (first === "status" && second === "--porcelain") return ok(output(options.porcelain));
		if (first === "ls-files") return ok(output(options.untracked));
		if (first === "rev-parse" && second === "HEAD") {
			return ok(output("", "fatal: no upstream", 128));
		}
		if (first === "rev-list" && second === "--count") return ok(output("0\n"));
		if (first === "log") return ok(output(""));
		return err(appError("git_failed", `unexpected command: ${command.args.join(" ")}`));
	});
}

const input = (depth: "metadata" | "uncommitted" | "full") => ({
	workspaceId,
	workspacePath: "/wt",
	targetRef: "refs/remotes/origin/main",
	remote: "origin",
	depth,
});

describe("GIT-04 status snapshot counts", () => {
	it("counts committed work as changed files and a clean tree as no uncommitted files", async () => {
		const runner = pollRunner({
			nameStatus: "M\tsrc/a.ts\n",
			numstat: "3\t1\tsrc/a.ts\n",
			porcelain: "",
			untracked: "",
		});

		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.depth).toBe("full");
		expect(result.value.changedFiles).toBe(1);
		expect(result.value.uncommittedFiles).toBe(0);
	});

	it("counts the working tree and leaves the branch comparison unknown for an uncommitted poll", async () => {
		const runner = pollRunner({
			nameStatus: "M\tsrc/a.ts\n",
			numstat: "3\t1\tsrc/a.ts\n",
			porcelain: " M src/a.ts\n",
			untracked: "",
		});

		const result = await refreshWorkspaceChanges(runner, input("uncommitted"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.depth).toBe("uncommitted");
		expect(result.value.changedFiles).toBeNull();
		expect(result.value.uncommittedFiles).toBe(1);
	});

	it("counts untracked files in the uncommitted total without listing them as branch changes", async () => {
		const runner = pollRunner({
			nameStatus: "M\tsrc/a.ts\n",
			numstat: "3\t1\tsrc/a.ts\n",
			porcelain: " M src/a.ts\n",
			untracked: "notes.md\0",
		});

		const result = await refreshWorkspaceChanges(runner, input("uncommitted"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.uncommittedFiles).toBe(2);
	});

	it("leaves both counts unknown for a metadata poll", async () => {
		const runner = pollRunner({
			nameStatus: "",
			numstat: "",
			porcelain: "",
			untracked: "",
		});

		const result = await refreshWorkspaceChanges(runner, input("metadata"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.depth).toBe("metadata");
		expect(result.value.uncommittedFiles).toBeNull();
		expect(result.value.changedFiles).toBeNull();
	});
});
