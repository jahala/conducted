/**
 * @feature REV-02 Viewed files
 * Tests that a viewed mark is saved, read back, and reset when the file changes.
 */
import { type AppError, appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileStat, FileSystem, ShellOutput } from "../../platform/platform.ts";
import { createActions } from "../actions.ts";
import { viewedFilesFile } from "../app-paths.ts";
import type { Services } from "../container.ts";
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

function fakeFs(options: { slowFirstWrite?: boolean } = {}) {
	const files = new Map<string, string>();
	let modifiedAt = 1;
	let readError: AppError | null = null;
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
		readText: async (path) => {
			if (readError !== null) return err(readError);
			return files.has(path)
				? ok(files.get(path) ?? "")
				: err(appError("fs_not_found", `${path} does not exist.`));
		},
		writeTextAtomic: async (path, text) => {
			const index = writes.length;
			writes.push(path);
			// A slow disk: the first write lands after many other steps, with no timer to wait on.
			if (options.slowFirstWrite === true && index === 0) {
				for (let tick = 0; tick < 200; tick += 1) await Promise.resolve();
			}
			files.set(path, text);
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
		viewedFile: viewedFilesFile(paths, String(workspaceId)),
		change: () => {
			modifiedAt += 1;
		},
		setReadError: (error: AppError | null) => {
			readError = error;
		},
	};
}

const makeService = (fs: ReturnType<typeof fakeFs>["fs"]): GitService =>
	new GitService({
		git: runner(),
		cache: {} as never,
		contextOf: async () => ({ ok: true, value: context }),
		agent: {} as never,
		renameWorkspaceBranch: async () => ok(undefined),
		now: () => 0,
		fs,
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
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

	it("returns a read error and saves nothing rather than wiping the marks", async () => {
		const fake = fakeFs();
		const first = makeService(fake.fs);
		await first.setViewed(workspaceId, "src/a.ts", true);
		const saved = fake.files.get(fake.viewedFile);
		expect(saved).toBeDefined();

		fake.setReadError(appError("fs_failed", "permission denied"));
		const second = makeService(fake.fs);
		const result = await second.setViewed(workspaceId, "src/other.ts", true);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("fs_failed");
		expect(fake.files.get(fake.viewedFile)).toBe(saved);
	});

	it("retries the read after a failure once it can read again", async () => {
		const fake = fakeFs();
		const first = makeService(fake.fs);
		await first.setViewed(workspaceId, "src/a.ts", true);

		fake.setReadError(appError("fs_failed", "permission denied"));
		const second = makeService(fake.fs);
		expect((await second.setViewed(workspaceId, "src/a.ts", true)).ok).toBe(false);

		fake.setReadError(null);
		const third = makeService(fake.fs);
		const result = await third.setViewed(workspaceId, "src/other.ts", true);
		expect(result.ok).toBe(true);
		const body = JSON.parse(fake.files.get(fake.viewedFile) ?? "{}") as {
			marks?: Record<string, { viewed?: boolean }>;
		};
		expect(body.marks?.["src/a.ts"]?.viewed).toBe(true);
		expect(body.marks?.["src/other.ts"]?.viewed).toBe(true);
	});

	it("returns an error for a damaged marks file instead of overwriting it", async () => {
		const fake = fakeFs();
		fake.files.set(fake.viewedFile, "{ not json");
		const service = makeService(fake.fs);
		const result = await service.setViewed(workspaceId, "src/a.ts", true);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("invalid_json");
		expect(fake.files.get(fake.viewedFile)).toBe("{ not json");
		expect(fake.writes).toHaveLength(0);
	});

	it("reaches the service through Actions.git.setViewed", async () => {
		const fake = fakeFs();
		const service = makeService(fake.fs);
		const actions = createActions(
			{ git: service } as unknown as Services,
			{} as unknown as Parameters<typeof createActions>[1],
		);
		const result = await actions.git.setViewed(workspaceId, "src/a.ts", true);
		expect(result.ok).toBe(true);
		expect(fake.writes).toHaveLength(1);
	});
});

describe("REV-02 viewed files written together", () => {
	it("keeps both marks when two files are marked at once and the first write is slow", async () => {
		const fake = fakeFs({ slowFirstWrite: true });
		const service = makeService(fake.fs);

		const [first, second] = await Promise.all([
			service.setViewed(workspaceId, "src/a.ts", true),
			service.setViewed(workspaceId, "src/b.ts", true),
		]);

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		const saved = JSON.parse(fake.files.get(fake.viewedFile) ?? "{}") as {
			marks: Record<string, unknown>;
		};
		expect(Object.keys(saved.marks).sort()).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("refuses a path that leaves the workspace", async () => {
		const fake = fakeFs();
		const service = makeService(fake.fs);

		const result = await service.setViewed(workspaceId, "../../etc/passwd", true);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("path_outside_workspace");
		expect(fake.writes).toHaveLength(0);
	});
});
