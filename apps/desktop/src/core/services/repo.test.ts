import { appError, err, ok, type RepoId, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { Dialogs, FileSystem, Opener, Shell, ShellOutput } from "../../platform/platform.ts";
import { createTestIds } from "../../test/ids.ts";
import type { NewRepo, RepoRepository } from "../db/repos.ts";
import type { GitCommand } from "../git/commands.ts";
import {
	branchShowCurrent,
	initRepository,
	remoteGetUrl,
	remoteSetUrl,
	revParse,
	symbolicRefRemoteHead,
} from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo } from "../model.ts";
import {
	defaultBranchFrom,
	hiddenRunActionsStorageKey,
	normaliseRemoteUrl,
	normaliseRootPath,
	projectNameFromPath,
	RepoService,
	type RepoServiceDeps,
} from "./repo.ts";

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

const commandKey = (command: GitCommand): string => `${command.program} ${command.args.join(" ")}`;

interface FakeGit {
	git: GitRunner;
	calls: GitCommand[];
	replies: Map<string, ShellOutput>;
}

function makeGit(): FakeGit {
	const calls: GitCommand[] = [];
	const replies = new Map<string, ShellOutput>();
	const replyFor = (command: GitCommand): ShellOutput =>
		replies.get(commandKey(command)) ?? output(0);
	return {
		calls,
		replies,
		git: {
			async run(command) {
				calls.push(command);
				return ok(replyFor(command));
			},
			async runChecked(command) {
				calls.push(command);
				const reply = replyFor(command);
				return reply.exitCode === 0
					? ok(reply)
					: err(appError("git_failed", reply.stderr || "git failed"));
			},
			async stdout(command) {
				calls.push(command);
				const reply = replies.get(commandKey(command));
				if (reply === undefined || reply.exitCode !== 0) {
					return err(appError("git_failed", reply?.stderr ?? "the command did not run"));
				}
				return ok(reply.stdout.trim());
			},
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

interface FakeRepos {
	api: RepoRepository;
	rows: Repo[];
	log: string[];
}

function makeRepos(): FakeRepos {
	const rows: Repo[] = [];
	const log: string[] = [];
	let nextId = 0;
	const find = (id: RepoId): Repo | undefined => rows.find((repo) => repo.id === id);
	const api: RepoRepository = {
		async list({ includeHidden }) {
			return ok(rows.filter((repo) => includeHidden || !repo.hidden));
		},
		async get(id) {
			return ok(find(id) ?? null);
		},
		async getByRootPath(rootPath) {
			return ok(rows.find((repo) => repo.rootPath === rootPath) ?? null);
		},
		async create(input: NewRepo) {
			if (rows.some((repo) => repo.rootPath === input.rootPath)) {
				return err(appError("db.conflict", "That folder is already a project."));
			}
			const repo: Repo = {
				id: `repo-${++nextId}` as RepoId,
				name: input.name,
				rootPath: input.rootPath,
				remoteUrl: input.remoteUrl,
				defaultBranch: input.defaultBranch,
				icon: input.icon,
				displayOrder: rows.length,
				hidden: input.hidden ?? false,
				createdAt: 1000,
				updatedAt: 1000,
			};
			rows.push(repo);
			return ok(repo);
		},
		async setDefaultBranch(id, branch) {
			const repo = find(id);
			if (repo !== undefined) repo.defaultBranch = branch;
			return ok(undefined);
		},
		async setRemoteUrl(id, url) {
			const repo = find(id);
			if (repo !== undefined) repo.remoteUrl = url;
			return ok(undefined);
		},
		async setIcon(id, icon) {
			const repo = find(id);
			if (repo !== undefined) repo.icon = icon;
			return ok(undefined);
		},
		async setHidden(id, hidden) {
			const repo = find(id);
			if (repo !== undefined) repo.hidden = hidden;
			return ok(undefined);
		},
		async reorder(orderedIds) {
			for (const [index, id] of orderedIds.entries()) {
				const repo = find(id);
				if (repo !== undefined) repo.displayOrder = index;
			}
			return ok(undefined);
		},
		async delete(id) {
			log.push("delete");
			const index = rows.findIndex((repo) => repo.id === id);
			if (index >= 0) rows.splice(index, 1);
			return ok(undefined);
		},
	};
	return { api, rows, log };
}

interface FakePlatform {
	platform: RepoServiceDeps["platform"];
	confirm: ReturnType<typeof vi.fn>;
	trash: ReturnType<typeof vi.fn>;
}

function makePlatform(options: { dirs?: readonly string[]; confirm?: boolean } = {}): FakePlatform {
	const dirs = new Set(options.dirs ?? []);
	const confirm = vi.fn(async () => options.confirm ?? true);
	const trash = vi.fn(async () => ok(undefined));
	const fs = {
		async stat(path: string) {
			if (!dirs.has(path)) return err(appError("fs_missing", `missing ${path}`));
			return ok({ path, isDirectory: true, isSymlink: false, size: 0, modifiedAt: 0 });
		},
		async exists() {
			return false;
		},
		async readText() {
			return err(appError("fs_missing", "no file"));
		},
		async writeTextAtomic() {
			return ok(undefined);
		},
		async mkdirp() {
			return ok(undefined);
		},
		async readDir() {
			return ok([]);
		},
		trash,
		async registerRoot() {
			return ok(undefined);
		},
		paths: { home: "/home/me", appData: "/app", temp: "/tmp", resources: "/resources" },
	} as unknown as FileSystem;
	const dialogs = {
		confirm,
		pickFolder: async () => null,
		pickFiles: async () => [],
		pickSavePath: async () => null,
	} as Dialogs;
	return {
		platform: { fs, dialogs, opener: {} as Opener, shell: {} as Shell },
		confirm,
		trash,
	};
}

function makeService(options: Parameters<typeof makePlatform>[0] = {}) {
	const repos = makeRepos();
	const git = makeGit();
	const platform = makePlatform(options);
	const removeWorkspacesOf = vi.fn(async () => {
		repos.log.push("workspaces");
		return ok(undefined);
	});
	const service = new RepoService({
		platform: platform.platform,
		git: git.git,
		repos: { repos: repos.api } as RepoServiceDeps["repos"],
		settings: {
			removeEnvVarsForRepo: async () => ok(undefined),
		} as unknown as RepoServiceDeps["settings"],
		removal: { removeWorkspacesOf, releaseBacklogOf: () => {} },
		ids: createTestIds(),
	});
	return { service, repos, git, platform, removeWorkspacesOf };
}

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

/** Answers git's work-tree probe and the checked-out branch for a folder. */
function markWorkTree(
	ctx: ReturnType<typeof makeService>,
	toplevel: string,
	branch = "main",
): void {
	ctx.git.replies.set(commandKey(revParse("--show-toplevel")), output(0, `${toplevel}\n`));
	ctx.git.replies.set(commandKey(branchShowCurrent()), output(0, `${branch}\n`));
}

describe("PRJ-01 path and remote helpers", () => {
	it("treats a trailing slash as the same folder", () => {
		expect(normaliseRootPath("/code/app/")).toBe("/code/app");
		expect(normaliseRootPath("  /code/app  ")).toBe("/code/app");
		expect(normaliseRootPath("/")).toBe("/");
	});

	it("names a project after its folder", () => {
		expect(projectNameFromPath("/code/app/")).toBe("app");
		expect(projectNameFromPath("/")).toBe("/");
	});

	it("trims a remote URL and drops a trailing slash", () => {
		expect(normaliseRemoteUrl(" git@github.com:owner/repo.git/ ")).toBe(
			"git@github.com:owner/repo.git",
		);
	});

	it("prefers the remote HEAD branch, then the checked-out branch", () => {
		expect(must(defaultBranchFrom("refs/remotes/origin/develop", "feature"))).toBe("develop");
		expect(must(defaultBranchFrom(null, "feature"))).toBe("feature");
	});

	it("fails instead of inventing a default branch when both are missing", () => {
		const missing = defaultBranchFrom(null, null);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.error.code).toBe("repo_default_branch_unknown");

		const empty = defaultBranchFrom(null, "");
		expect(empty.ok).toBe(false);
		if (!empty.ok) expect(empty.error.code).toBe("repo_default_branch_unknown");
	});
});

describe("PRJ-01 adding a local folder", () => {
	it("returns the same project when the same folder is added twice", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		markWorkTree(ctx, "/code/app");

		const first = must(await ctx.service.addLocal("/code/app/"));
		const second = must(await ctx.service.addLocal("/code/app"));

		expect(second.id).toBe(first.id);
		expect(ctx.repos.rows).toHaveLength(1);
		expect(ctx.repos.rows[0]?.name).toBe("app");
		expect(ctx.service.store.getState().order).toEqual([first.id]);
	});

	it("asks before turning a folder without git into a repository", async () => {
		const ctx = makeService({ dirs: ["/code/notes"], confirm: false });

		const result = await ctx.service.addLocal("/code/notes");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("not_git");
		expect(ctx.platform.confirm).toHaveBeenCalledTimes(1);
		expect(
			ctx.git.calls.some((command) => commandKey(command) === commandKey(initRepository())),
		).toBe(false);
		expect(ctx.repos.rows).toHaveLength(0);
	});

	it("runs git init after the user agrees", async () => {
		const ctx = makeService({ dirs: ["/code/notes"], confirm: true });
		ctx.git.replies.set(commandKey(branchShowCurrent()), output(0, "main\n"));

		const repo = must(await ctx.service.addLocal("/code/notes"));

		expect(repo.rootPath).toBe("/code/notes");
		expect(
			ctx.git.calls.some((command) => commandKey(command) === commandKey(initRepository())),
		).toBe(true);
		expect(ctx.repos.rows).toHaveLength(1);
	});

	it("adds a subfolder as the repository's root, without a nested git init", async () => {
		const ctx = makeService({ dirs: ["/code/app", "/code/app/sub"] });
		markWorkTree(ctx, "/code/app");

		const fromSubfolder = must(await ctx.service.addLocal("/code/app/sub"));

		expect(fromSubfolder.rootPath).toBe("/code/app");
		expect(fromSubfolder.name).toBe("app");
		expect(ctx.platform.confirm).not.toHaveBeenCalled();
		expect(
			ctx.git.calls.some((command) => commandKey(command) === commandKey(initRepository())),
		).toBe(false);
		const again = must(await ctx.service.addLocal("/code/app"));
		expect(again.id).toBe(fromSubfolder.id);
		expect(ctx.repos.rows).toHaveLength(1);
	});

	it("rejects a folder that does not exist", async () => {
		const ctx = makeService({ dirs: [] });

		const result = await ctx.service.addLocal("/code/missing");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_path_missing");
		expect(ctx.repos.rows).toHaveLength(0);
	});

	it("reads the remote URL and writes the normalised form back", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		markWorkTree(ctx, "/code/app");
		ctx.git.replies.set(
			commandKey(remoteGetUrl("origin")),
			output(0, " git@github.com:owner/repo.git/ \n"),
		);

		const repo = must(await ctx.service.addLocal("/code/app"));

		expect(repo.remoteUrl).toBe("git@github.com:owner/repo.git");
		expect(
			ctx.git.calls.some(
				(command) =>
					commandKey(command) ===
					commandKey(remoteSetUrl("origin", "git@github.com:owner/repo.git")),
			),
		).toBe(true);
	});

	it("detects the default branch from the remote HEAD", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		markWorkTree(ctx, "/code/app", "feature");
		ctx.git.replies.set(
			commandKey(symbolicRefRemoteHead("origin")),
			output(0, "refs/remotes/origin/develop\n"),
		);

		const repo = must(await ctx.service.addLocal("/code/app"));

		expect(repo.defaultBranch).toBe("develop");
	});

	it("falls back to the checked-out branch when there is no remote HEAD", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		markWorkTree(ctx, "/code/app", "feature");
		ctx.git.replies.set(
			commandKey(symbolicRefRemoteHead("origin")),
			output(128, "", "fatal: no such ref"),
		);

		const repo = must(await ctx.service.addLocal("/code/app"));

		expect(repo.defaultBranch).toBe("feature");
	});

	it("shows an error when there is no remote HEAD and no checked-out branch", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		ctx.git.replies.set(commandKey(revParse("--show-toplevel")), output(0, "/code/app\n"));
		ctx.git.replies.set(commandKey(branchShowCurrent()), output(0, "\n"));

		const result = await ctx.service.addLocal("/code/app");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_default_branch_unknown");
		expect(ctx.repos.rows).toHaveLength(0);
	});
});

describe("PRJ-01 listing and removing projects", () => {
	it("lists projects on start and keeps hidden ones out of the sidebar order", async () => {
		const ctx = makeService();
		ctx.repos.rows.push(
			{
				id: "repo-a" as RepoId,
				name: "alpha",
				rootPath: "/code/alpha",
				remoteUrl: null,
				defaultBranch: "main",
				icon: null,
				displayOrder: 0,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "repo-b" as RepoId,
				name: "beta",
				rootPath: "/code/beta",
				remoteUrl: null,
				defaultBranch: "main",
				icon: null,
				displayOrder: 1,
				hidden: true,
				createdAt: 1,
				updatedAt: 1,
			},
		);

		must(await ctx.service.start());

		const state = ctx.service.store.getState();
		expect(state.loaded).toBe(true);
		expect(state.reposById["repo-a"]?.name).toBe("alpha");
		expect(state.reposById["repo-b"]?.hidden).toBe(true);
		expect(state.order).toEqual(["repo-a"]);
	});

	it("hides and shows a project without losing it", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		markWorkTree(ctx, "/code/app");
		const repo = must(await ctx.service.addLocal("/code/app"));

		must(await ctx.service.setHidden(repo.id, true));
		expect(ctx.service.store.getState().order).toEqual([]);
		expect(ctx.service.store.getState().reposById[repo.id]?.hidden).toBe(true);

		must(await ctx.service.setHidden(repo.id, false));
		expect(ctx.service.store.getState().order).toEqual([repo.id]);
	});

	it("removes the project's workspaces before deleting the row and leaves the main folder alone", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		markWorkTree(ctx, "/code/app");
		const repo = must(await ctx.service.addLocal("/code/app"));

		must(await ctx.service.remove(repo.id));

		expect(ctx.removeWorkspacesOf).toHaveBeenCalledWith(repo.id);
		expect(ctx.repos.log).toEqual(["workspaces", "delete"]);
		expect(ctx.repos.rows).toHaveLength(0);
		expect(ctx.service.store.getState().reposById[repo.id]).toBeUndefined();
		expect(ctx.service.store.getState().order).toEqual([]);
		expect(ctx.platform.trash).not.toHaveBeenCalled();
	});

	it("removes the project's hidden run actions from local storage", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		markWorkTree(ctx, "/code/app");
		const repo = must(await ctx.service.addLocal("/code/app"));
		const key = hiddenRunActionsStorageKey(repo.id);
		localStorage.setItem(key, '["dev"]');

		try {
			must(await ctx.service.remove(repo.id));
			expect(localStorage.getItem(key)).toBeNull();
		} finally {
			localStorage.removeItem(key);
		}
	});
});
