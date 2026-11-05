/**
 * @feature REV-02 Viewed files
 * Tests that a viewed mark is saved, read back, and reset when the file changes.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileStat, FileSystem, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import { GitService, type WorkspaceGitContext } from "./git.ts";

const workspaceId = "ws-1" as WorkspaceId;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

function runner(): GitRunner {
	const run = async (command: GitCommand): Promise<Result<ShellOutput>> => {
		const args = command.args;
		if (args[0] === "branch" && args[1] === "--show-current") return ok(output("feat\n"));
		if (args[0] === "merge-base") return ok(output("mb\n"));
		if (args[0] === "show-ref") return ok(output("", "", 1));
		if (args[0] === "diff" && args.includes("--name-status")) return ok(output("M\tsrc/a.ts\n"));
		if (args[0] === "diff" && args.includes("--numstat")) return ok(output("3\t1\tsrc/a.ts\n"));
		if (args[0] === "status") return ok(output(""));
		if (args[0] === "ls-files") return ok(output(""));
		return ok(output());
	};
	return {
		run,
		runChecked: async (command) => {
			const result = await run(command);
			return result.ok && (command.okExitCodes ?? [0]).includes(result.value.exitCode)
				? result
				: err(appError("git_failed", "git failed"));
		},
		stdout: async (command) => {
			const result = await run(command);
			return result.ok ? ok(result.value.stdout.trim()) : result;
		},
		start: async () => {
			throw new Error("start is not used");
		},
		withWorktreeLock: (_path, work) => work(),
		withWorktreeAndRepoLocks: (_path, _root, work) => work(),
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

function fakeFs() {
	const files = new Map<string, string>();
	let modifiedAt = 1;
	const writes: string[] = [];
	const paths = {
		home: "/Users/a",
		appData: "/Users/a/Library/App",
		temp: "/tmp",
		resources: "/app/resources",
	};
	const fs: Pick<
		FileSystem,
		"trash" | "readText" | "writeTextAtomic" | "mkdirp" | "stat" | "paths"
	> = {
		trash: async () => ok(undefined),
		readText: async (path) =>
			files.has(path) ? ok(files.get(path) ?? "") : err(appError("not_found", path)),
		writeTextAtomic: async (path, text) => {
			files.set(path, text);
			writes.push(path);
			return ok(undefined);
		},
		mkdirp: async () => ok(undefined),
		stat: async (path): Promise<Result<FileStat>> =>
			ok({ path, isDirectory: false, isSymlink: false, size: 10, modifiedAt }),
		paths,
	};
	return {
		fs,
		writes,
		files,
		change: () => {
			modifiedAt += 1;
		},
	};
}

const makeService = (fs: ReturnType<typeof fakeFs>["fs"]): GitService =>
	new GitService({
		git: runner(),
		cache: {} as never,
		contextOf: async () => ({ ok: true, value: context }),
		agent: {} as never,
		now: () => 0,
		fs,
	});

describe("REV-02 viewed files", () => {
	it("saves a viewed mark and resets it when the file changes", async () => {
		const fake = fakeFs();
		const service = makeService(fake.fs);

		const before = await service.changedFiles(workspaceId, { kind: "branch" });
		expect(before.ok).toBe(true);
		if (!before.ok) return;
		expect(before.value[0]?.viewed).toBe(false);

		const saved = await service.setViewed(workspaceId, "src/a.ts", true);
		expect(saved.ok).toBe(true);
		expect(fake.writes).toHaveLength(1);

		const after = await service.changedFiles(workspaceId, { kind: "branch" });
		expect(after.ok).toBe(true);
		if (!after.ok) return;
		expect(after.value[0]?.viewed).toBe(true);

		fake.change();
		const changed = await service.changedFiles(workspaceId, { kind: "branch" });
		expect(changed.ok).toBe(true);
		if (!changed.ok) return;
		expect(changed.value[0]?.viewed).toBe(false);
	});

	it("reads saved marks back for a new service", async () => {
		const fake = fakeFs();
		const first = makeService(fake.fs);
		await first.setViewed(workspaceId, "src/a.ts", true);

		const second = makeService(fake.fs);
		const files = await second.changedFiles(workspaceId, { kind: "branch" });
		expect(files.ok).toBe(true);
		if (!files.ok) return;
		expect(files.value[0]?.viewed).toBe(true);
	});

	it("turns a mark off again", async () => {
		const fake = fakeFs();
		const service = makeService(fake.fs);
		await service.setViewed(workspaceId, "src/a.ts", true);
		await service.setViewed(workspaceId, "src/a.ts", false);
		const files = await service.changedFiles(workspaceId, { kind: "branch" });
		expect(files.ok).toBe(true);
		if (!files.ok) return;
		expect(files.value[0]?.viewed).toBe(false);
	});
});
