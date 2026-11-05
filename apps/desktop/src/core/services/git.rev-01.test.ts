import {
	appError,
	err,
	ok,
	type Result,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import { GitService, type WorkspaceGitContext } from "./git.ts";

const workspaceId = "ws-1" as WorkspaceId;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

interface Recorder {
	commands: GitCommand[];
}

function runner(override?: (command: GitCommand) => ShellOutput | null): {
	git: GitRunner;
	recorder: Recorder;
} {
	const recorder: Recorder = { commands: [] };

	const reply = (command: GitCommand): ShellOutput => {
		recorder.commands.push(command);
		const replaced = override?.(command);
		if (replaced !== null && replaced !== undefined) return replaced;
		const args = command.args;
		const ref = args.at(-1) ?? "";
		if (args[0] === "branch" && args[1] === "--show-current") return output("feat\n");
		if (args[0] === "merge-base") return output("mb\n");
		if (args[0] === "show-ref") return output("", "", 1);
		if (args[0] === "diff" && args.includes("--name-status")) {
			if (args.includes("--no-index")) return output("2\t0\tuntracked.ts\n");
			return output("M\tsrc/a.ts\nR100\told.ts\tnew.ts\n");
		}
		if (args[0] === "diff" && args.includes("--numstat")) {
			if (args.includes("--no-index")) return output("2\t0\tuntracked.ts\n");
			return output("3\t1\tsrc/a.ts\n1\t1\tnew.ts\n");
		}
		if (args[0] === "show" && args.includes("--name-status")) return output("M\tone.ts\n");
		if (args[0] === "show" && args.includes("--numstat")) return output("5\t2\tone.ts\n");
		if (args[0] === "status") return output("UU src/a.ts\n");
		if (args[0] === "ls-files") return output("untracked.ts\0");
		if (command.program === "stat") return output("10\n");
		if (args[0] === "cat-file") return output("", "", ref.endsWith(":old.ts") ? 0 : 1);
		if (args[0] === "restore" || args[0] === "rm") return output("");
		if (args[0] === "diff") return output("diff --git a/src/a.ts b/src/a.ts\n");
		return output("");
	};

	const run = async (command: GitCommand): Promise<Result<ShellOutput>> => ok(reply(command));
	const runChecked = async (command: GitCommand): Promise<Result<ShellOutput>> => {
		const result = await run(command);
		if (!result.ok) return result;
		const codes = command.okExitCodes ?? [0];
		if (codes.includes(result.value.exitCode)) return result;
		return err(appError("git_failed", result.value.stderr.trim() || "git failed"));
	};
	const stdout = async (command: GitCommand): Promise<Result<string>> => {
		const result = await runChecked(command);
		return result.ok ? ok(result.value.stdout.trim()) : result;
	};

	return {
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
		recorder,
	};
}

const context: WorkspaceGitContext = {
	workspaceId,
	workspacePath: "/repo/worktree",
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feat",
};

const makeService = (
	git: GitRunner,
	trash: (path: string) => Promise<Result<void>> = async () => ok(undefined),
): GitService =>
	new GitService({
		git,
		cache: {} as never,
		contextOf: async () => ({ ok: true, value: context }),
		agent: {} as never,
		renameWorkspaceBranch: async () => ok(undefined),
		now: () => 0,
		fs: {
			trash,
			readText: async () => err(appError("fs_not_found", "missing")),
			writeTextAtomic: async () => ok(undefined),
			mkdirp: async () => ok(undefined),
			stat: async () => err(appError("fs_not_found", "missing")),
			paths: { home: "", appData: "", temp: "", resources: "" },
		},
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
	});

// `--no-index` diffs count untracked files against /dev/null; they never compare with a revision.
const hasDiff = (commands: GitCommand[], kind: "name-status" | "numstat"): GitCommand[] =>
	commands.filter(
		(command) =>
			command.args[0] === "diff" &&
			command.args.includes(`--${kind}`) &&
			!command.args.includes("--no-index"),
	);

describe("REV-01 git service diff scopes", () => {
	it("compares the branch scope from the merge base to the working tree", async () => {
		const { git, recorder } = runner();
		const service = makeService(git);
		const files = await service.changedFiles(workspaceId, { kind: "branch" });
		expect(files.ok).toBe(true);
		if (!files.ok) return;
		expect(files.value.map((file) => file.path)).toEqual(["src/a.ts", "new.ts", "untracked.ts"]);
		expect(files.value[0]).toMatchObject({ conflicted: true, viewed: false });
		expect(files.value[2]).toMatchObject({
			status: "added",
			linesAdded: 2,
			conflicted: false,
		});
		for (const command of hasDiff(recorder.commands, "name-status")) {
			expect(command.args).toContain("mb");
			expect(command.args).not.toContain("HEAD");
		}
	});

	it("compares the uncommitted scope from HEAD", async () => {
		const { git, recorder } = runner();
		const service = makeService(git);
		const resolved = await service.resolveScope(workspaceId, { kind: "uncommitted" });
		expect(resolved).toEqual({
			ok: true,
			value: { cwd: "/repo/worktree", from: "HEAD", to: null },
		});
		const files = await service.changedFiles(workspaceId, { kind: "uncommitted" });
		expect(files.ok).toBe(true);
		for (const command of hasDiff(recorder.commands, "numstat")) {
			expect(command.args).toContain("HEAD");
		}
	});

	it("reads a commit's files from show with name-status and numstat", async () => {
		const { git, recorder } = runner();
		const service = makeService(git);
		const files = await service.changedFiles(workspaceId, { kind: "commit", sha: "abc" });
		expect(files).toEqual({
			ok: true,
			value: [
				{
					path: "one.ts",
					status: "modified",
					linesAdded: 5,
					linesRemoved: 2,
					binary: false,
					conflicted: false,
					viewed: false,
				},
			],
		});
		const shows = recorder.commands.filter((command) => command.args[0] === "show");
		expect(shows.some((command) => command.args.includes("--name-status"))).toBe(true);
		expect(shows.some((command) => command.args.includes("--numstat"))).toBe(true);
		expect(recorder.commands.some((command) => command.args[0] === "status")).toBe(false);
	});

	it("compares a finished turn from its start to its end checkpoint", async () => {
		const { git, recorder } = runner((command) =>
			command.args[0] === "show-ref" ? output("", "", 0) : null,
		);
		const service = makeService(git);
		const resolved = await service.resolveScope(workspaceId, {
			kind: "turn",
			sessionId: "s1" as SessionId,
			turnId: "t1" as TurnId,
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.value.to).toContain("turn-t1-end");
		await service.changedFiles(workspaceId, {
			kind: "turn",
			sessionId: "s1" as SessionId,
			turnId: "t1" as TurnId,
		});
		expect(recorder.commands.some((command) => command.args[0] === "ls-files")).toBe(false);
		expect(recorder.commands.some((command) => command.args[0] === "status")).toBe(false);
	});

	it("passes a broken merge-base failure on instead of calling it no common ancestor", async () => {
		const { git } = runner((command) =>
			command.args[0] === "merge-base" ? output("", "fatal: not a git repository", 128) : null,
		);
		const service = makeService(git);
		const resolved = await service.resolveScope(workspaceId, { kind: "branch" });
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.error.code).toBe("git_failed");
		expect(resolved.error.message).toContain("not a git repository");
	});

	it("still reports a missing merge base when git exits with code 1", async () => {
		const { git } = runner((command) =>
			command.args[0] === "merge-base" ? output("", "", 1) : null,
		);
		const service = makeService(git);
		const resolved = await service.resolveScope(workspaceId, { kind: "branch" });
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.error.code).toBe("no_merge_base");
	});

	it("passes a broken checkpoint probe on instead of dropping the turn", async () => {
		const { git } = runner((command) =>
			command.args[0] === "show-ref" ? output("", "fatal: bad object", 2) : null,
		);
		const service = makeService(git);
		const resolved = await service.resolveScope(workspaceId, {
			kind: "turn",
			sessionId: "s1" as SessionId,
			turnId: "t1" as TurnId,
		});
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.error.code).toBe("git_failed");
	});

	it("compares a root commit against git's empty tree", async () => {
		const { git } = runner((command) =>
			command.args[0] === "rev-parse" && command.args.includes("--verify")
				? output("", "", 1)
				: null,
		);
		const service = makeService(git);
		const resolved = await service.resolveScope(workspaceId, {
			kind: "commit",
			sha: "root",
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.value.from).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
		expect(resolved.value.to).toBe("root");
	});

	it("refuses a turn whose start checkpoint does not exist", async () => {
		const { git } = runner();
		const service = makeService(git);
		const resolved = await service.resolveScope(workspaceId, {
			kind: "turn",
			sessionId: "s1" as SessionId,
			turnId: "t1" as TurnId,
		});
		expect(resolved.ok).toBe(false);
	});

	it("takes the agent diff against the merge base, with a stat form", async () => {
		const { git, recorder } = runner();
		const service = makeService(git);
		const diff = await service.agentDiff(workspaceId, "src/a.ts", true);
		expect(diff.ok).toBe(true);
		const agentDiff = recorder.commands.at(-1);
		expect(agentDiff?.args).toContain("--stat");
		expect(agentDiff?.args).toContain("mb");
		expect(agentDiff?.args).toContain(":(literal)src/a.ts");
	});
});

describe("REV-01 git service discard", () => {
	it("restores a renamed file's old path from the merge base and removes the new path", async () => {
		const { git, recorder } = runner();
		const service = makeService(git);
		const result = await service.discardFile(workspaceId, "new.ts");
		expect(result.ok).toBe(true);
		const restore = recorder.commands.find((command) => command.args[0] === "restore");
		expect(restore?.args).toEqual([
			"restore",
			"--source=mb",
			"--worktree",
			"--staged",
			"--",
			"old.ts",
		]);
		const remove = recorder.commands.find((command) => command.args[0] === "rm");
		expect(remove?.args).toEqual(["rm", "--cached", "--force", "--", "new.ts"]);
	});

	it("moves a file the branch added to the Trash after unstaging it", async () => {
		const { git, recorder } = runner();
		const trashed: string[] = [];
		const service = makeService(git, async (path) => {
			trashed.push(path);
			return ok(undefined);
		});
		const result = await service.discardFile(workspaceId, "added.ts");
		expect(result.ok).toBe(true);
		const unstage = recorder.commands.find((command) => command.args[0] === "restore");
		expect(unstage?.args).toEqual(["restore", "--staged", "--", "added.ts"]);
		expect(trashed).toEqual(["/repo/worktree/added.ts"]);
	});
});

describe("REV-01 git service refuses unsafe input", () => {
	it("does not discard or trash a path that leaves the workspace", async () => {
		const { git, recorder } = runner();
		const trashed: string[] = [];
		const service = makeService(git, async (path) => {
			trashed.push(path);
			return ok(undefined);
		});

		const result = await service.discardFile(workspaceId, "../outside.txt");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("path_outside_workspace");
		expect(trashed).toEqual([]);
		expect(recorder.commands).toEqual([]);
	});

	it("keeps the file when git cannot say whether the base has it", async () => {
		const { git } = runner((command) =>
			command.args[0] === "cat-file" ? output("", "fatal: not a git repository", 128) : null,
		);
		const trashed: string[] = [];
		const service = makeService(git, async (path) => {
			trashed.push(path);
			return ok(undefined);
		});

		const result = await service.discardFile(workspaceId, "added.ts");

		expect(result.ok).toBe(false);
		expect(trashed).toEqual([]);
	});

	it("trashes a file the base lacks when git says the path does not exist in it", async () => {
		const { git } = runner((command) =>
			command.args[0] === "cat-file"
				? output("", "fatal: path 'added.ts' does not exist in 'mb'", 128)
				: null,
		);
		const trashed: string[] = [];
		const service = makeService(git, async (path) => {
			trashed.push(path);
			return ok(undefined);
		});

		const result = await service.discardFile(workspaceId, "added.ts");

		expect(result.ok).toBe(true);
		expect(trashed).toEqual(["/repo/worktree/added.ts"]);
	});

	it("refuses a commit id that git could read as an option", async () => {
		const { git, recorder } = runner();
		const service = makeService(git);

		const files = await service.changedFiles(workspaceId, {
			kind: "commit",
			sha: "--output=/tmp/x",
		});
		const resolved = await service.resolveScope(workspaceId, {
			kind: "commit",
			sha: "--output=/tmp/x",
		});

		expect(files.ok).toBe(false);
		expect(resolved.ok).toBe(false);
		expect(recorder.commands.some((command) => command.args[0] === "show")).toBe(false);
		expect(recorder.commands.some((command) => command.args[0] === "rev-parse")).toBe(false);
	});
});
