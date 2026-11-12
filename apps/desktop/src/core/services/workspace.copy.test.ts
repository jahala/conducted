/**
 * @feature WS-03 Setup script in a terminal
 * Owns: tests for copying the configured files into a new worktree against a real folder, so the
 * 256 KiB cap, folder patterns, file modes and the warnings are exercised on real files.
 * Test first: a folder pattern copies its nested files, and a file over 256 KiB warns and stays
 * behind.
 */
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appError, err, ok, type RepoId, type Result, type WorkspaceId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo, Workspace } from "../model.ts";
import {
	COPY_FILE_SIZE_LIMIT,
	type CopyIncludedFilesDeps,
	copyIncludedFiles,
} from "./workspace-creation.ts";

const repo = (rootPath: string): Repo => ({
	id: "r1" as RepoId,
	name: "Project",
	rootPath,
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
});

const workspace = (path: string): Workspace => ({
	id: "w1" as WorkspaceId,
	repoId: "r1" as RepoId,
	directoryName: "oslo",
	path,
	branch: "oslo",
	branchIsPlaceholder: true,
	remoteFileSyncEnabled: false,
	host: { kind: "local" },
	displayName: null,
	targetBranch: "main",
	state: "initializing",
	kanbanStatus: "in_progress",
	port: 55_000,
	pinnedAt: null,
	linkedPaths: [],
	prNumber: null,
	prTitle: null,
	prDescription: null,
	archiveCommit: null,
	archivedAt: null,
	activeSessionId: null,
	filesCopied: null,
	lastActivityAt: 1,
	createdAt: 1,
	updatedAt: 1,
});

const fsAdapter: CopyIncludedFilesDeps["fs"] = {
	readText: async (path) => {
		try {
			return ok(await readFile(path, "utf8"));
		} catch (cause) {
			return err(appError("fs_read_failed", `Couldn't read ${path}.`, cause));
		}
	},
	exists: async (path) => {
		try {
			await stat(path);
			return ok(true);
		} catch {
			return ok(false);
		}
	},
	stat: async (path) => {
		try {
			const found = await stat(path);
			return ok({
				path,
				isDirectory: found.isDirectory(),
				isSymlink: found.isSymbolicLink(),
				size: found.size,
				modifiedAt: found.mtimeMs,
			});
		} catch (cause) {
			return err(appError("fs_not_found", `Couldn't read ${path}.`, cause));
		}
	},
	mkdirp: async (path) => {
		try {
			await mkdir(path, { recursive: true });
			return ok(undefined);
		} catch (cause) {
			return err(appError("fs_mkdir_failed", `Couldn't create ${path}.`, cause));
		}
	},
	readDir: async (path) => {
		try {
			const names = await readdir(path);
			const entries = await Promise.all(
				names.map(async (name) => {
					const child = `${path.replace(/\/$/, "")}/${name}`;
					const found = await stat(child);
					return {
						path: child,
						isDirectory: found.isDirectory(),
						isSymlink: found.isSymbolicLink(),
						size: found.size,
						modifiedAt: found.mtimeMs,
					};
				}),
			);
			return ok(entries);
		} catch (cause) {
			return err(appError("fs_read_failed", `Couldn't read ${path}.`, cause));
		}
	},
};

const shell: CopyIncludedFilesDeps["shell"] = {
	run: (command) =>
		new Promise<Result<ShellOutput>>((resolve) => {
			execFile(
				command.program,
				[...command.args],
				{ cwd: command.cwd },
				(error, stdout, stderr) => {
					if (error !== null) {
						resolve(
							ok({
								exitCode: typeof error.code === "number" ? error.code : 1,
								stdout,
								stderr,
							}),
						);
						return;
					}
					resolve(ok({ exitCode: 0, stdout, stderr }));
				},
			);
		}),
};

const gitListing = (stdout: string): GitRunner =>
	({ run: async () => ok({ exitCode: 0, stdout, stderr: "" }) }) as unknown as GitRunner;

let root = "";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "conducted-ws03-copy-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("WS-03 copyIncludedFiles on real files", () => {
	it("copies folder patterns and single files, keeping the file mode", async () => {
		const repoRoot = join(root, "repo");
		const workspacePath = join(root, "worktree");
		await mkdir(join(repoRoot, "config", "nested"), { recursive: true });
		await mkdir(workspacePath, { recursive: true });
		await writeFile(join(repoRoot, ".worktreeinclude"), "config/\n.env*\n");
		await writeFile(join(repoRoot, ".env"), "TOKEN=1\n");
		await chmod(join(repoRoot, ".env"), 0o600);
		await writeFile(join(repoRoot, "config", "app.json"), "{}\n");
		await writeFile(join(repoRoot, "config", "nested", "deep.json"), "{}\n");

		const result = await copyIncludedFiles(
			{
				fs: fsAdapter,
				shell,
				git: gitListing(".env\0config/\0"),
			},
			repo(repoRoot),
			workspace(workspacePath),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual([]);
		expect(await readFile(join(workspacePath, ".env"), "utf8")).toBe("TOKEN=1\n");
		expect(await readFile(join(workspacePath, "config", "nested", "deep.json"), "utf8")).toBe(
			"{}\n",
		);
		const mode = (await stat(join(workspacePath, ".env"))).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it("keeps a file that is already in the worktree, so a retry cannot overwrite the user's edits", async () => {
		const repoRoot = join(root, "repo");
		const workspacePath = join(root, "worktree");
		await mkdir(repoRoot, { recursive: true });
		await mkdir(workspacePath, { recursive: true });
		await writeFile(join(repoRoot, ".env"), "TOKEN=from-repo\n");
		await writeFile(join(workspacePath, ".env"), "TOKEN=edited-in-worktree\n");

		const result = await copyIncludedFiles(
			{ fs: fsAdapter, shell, git: gitListing(".env\0") },
			repo(repoRoot),
			workspace(workspacePath),
		);

		expect(result.ok).toBe(true);
		expect(await readFile(join(workspacePath, ".env"), "utf8")).toBe("TOKEN=edited-in-worktree\n");
	});

	it("skips a file over 256 KiB and says so", async () => {
		const repoRoot = join(root, "repo");
		const workspacePath = join(root, "worktree");
		await mkdir(repoRoot, { recursive: true });
		await mkdir(workspacePath, { recursive: true });
		await writeFile(join(repoRoot, ".worktreeinclude"), "big.bin\n");
		await writeFile(join(repoRoot, "big.bin"), "x".repeat(COPY_FILE_SIZE_LIMIT + 1));

		const result = await copyIncludedFiles(
			{ fs: fsAdapter, shell, git: gitListing("big.bin\0") },
			repo(repoRoot),
			workspace(workspacePath),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual(["Skipped big.bin: larger than 256 KiB."]);
		expect(await fsAdapter.exists(join(workspacePath, "big.bin"))).toEqual(ok(false));
	});

	it("warns when the repository file list cannot be read", async () => {
		const repoRoot = join(root, "repo");
		const workspacePath = join(root, "worktree");
		await mkdir(repoRoot, { recursive: true });
		await mkdir(workspacePath, { recursive: true });
		await writeFile(join(repoRoot, ".env"), "TOKEN=1\n");

		const result = await copyIncludedFiles(
			{
				fs: fsAdapter,
				shell,
				git: gitListing(".env\0"),
				repoConfig: async () => err(appError("repo_config_failed", "The file is broken.")),
			},
			repo(repoRoot),
			workspace(workspacePath),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toContain("Couldn't read the repository's file list: The file is broken.");
		expect(await fsAdapter.exists(join(workspacePath, ".env"))).toEqual(ok(true));
	});

	it("warns when .worktreeinclude cannot be read", async () => {
		const repoRoot = join(root, "repo");
		const workspacePath = join(root, "worktree");
		await mkdir(join(repoRoot, ".worktreeinclude"), { recursive: true });
		await mkdir(workspacePath, { recursive: true });

		const result = await copyIncludedFiles(
			{ fs: fsAdapter, shell, git: gitListing("") },
			repo(repoRoot),
			workspace(workspacePath),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(
			result.value.some((warning) => warning.startsWith("Couldn't read .worktreeinclude")),
		).toBe(true);
	});
});
