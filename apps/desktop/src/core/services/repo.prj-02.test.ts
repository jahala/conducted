import { appError, err, ok, type RepoId, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { Dialogs, FileSystem, Opener, Shell, ShellOutput } from "../../platform/platform.ts";
import { createTestIds } from "../../test/ids.ts";
import type { NewRepo, RepoRepository } from "../db/repos.ts";
import type { GitCommand } from "../git/commands.ts";
import {
	branchShowCurrent,
	checkout,
	cloneWithProgress,
	remoteGetUrl,
	revParse,
	symbolicRefRemoteHead,
} from "../git/commands.ts";
import { githubRepoClone } from "../git/gh-commands.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo } from "../model.ts";
import {
	type CloneProgress,
	joinFolder,
	RepoService,
	type RepoServiceDeps,
	repoNameFromUrl,
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
	onRunChecked: ((command: GitCommand) => void) | null;
}

function makeGit(): FakeGit {
	const calls: GitCommand[] = [];
	const replies = new Map<string, ShellOutput>();
	const fake: FakeGit = {
		calls,
		replies,
		onRunChecked: null,
		git: {
			async run(command) {
				calls.push(command);
				return ok(replies.get(commandKey(command)) ?? output(0));
			},
			async runChecked(command) {
				calls.push(command);
				fake.onRunChecked?.(command);
				const reply = replies.get(commandKey(command)) ?? output(0);
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
	return fake;
}

interface FakeRepos {
	api: RepoRepository;
	rows: Repo[];
}

function makeRepos(): FakeRepos {
	const rows: Repo[] = [];
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
		async setDefaultBranch() {
			return ok(undefined);
		},
		async setRemoteUrl() {
			return ok(undefined);
		},
		async setIcon() {
			return ok(undefined);
		},
		async setHidden() {
			return ok(undefined);
		},
		async reorder() {
			return ok(undefined);
		},
		async delete(id) {
			const index = rows.findIndex((repo) => repo.id === id);
			if (index >= 0) rows.splice(index, 1);
			return ok(undefined);
		},
	};
	return { api, rows };
}

interface FakePlatform {
	platform: RepoServiceDeps["platform"];
}

function makePlatform(
	options: { dirs?: readonly string[]; unwritable?: readonly string[] } = {},
): FakePlatform {
	const dirs = new Set(options.dirs ?? []);
	const unwritable = new Set(options.unwritable ?? []);
	const fs = {
		async stat(path: string) {
			if (!dirs.has(path)) return err(appError("fs_missing", `missing ${path}`));
			return ok({ path, isDirectory: true, isSymlink: false, size: 0, modifiedAt: 0 });
		},
		async exists() {
			return ok(false);
		},
		async readText() {
			return err(appError("fs_missing", "no file"));
		},
		async writeTextAtomic() {
			return ok(undefined);
		},
		async mkdirp(path: string) {
			if (unwritable.has(path)) return err(appError("fs_io", `cannot create ${path}`));
			dirs.add(path);
			return ok(undefined);
		},
		async readDir() {
			return ok([]);
		},
		async trash() {
			return ok(undefined);
		},
		async registerRoot() {
			return ok(undefined);
		},
		paths: { home: "/home/me", appData: "/app", temp: "/tmp", resources: "/resources" },
	} as unknown as FileSystem;
	const dialogs = {
		confirm: async () => false,
		pickFolder: async () => null,
		pickFiles: async () => [],
		pickSavePath: async () => null,
	} as Dialogs;
	return { platform: { fs, dialogs, opener: {} as Opener, shell: {} as Shell } };
}

function makeService(
	options: {
		dirs?: readonly string[];
		unwritable?: readonly string[];
		settings?: Record<string, unknown>;
	} = {},
) {
	const prefs = new Map<string, unknown>([
		["conductor_root_path", "~/conducted"],
		["last_clone_directory", ""],
		...Object.entries(options.settings ?? {}),
	]);
	const repos = makeRepos();
	const git = makeGit();
	const platform = makePlatform(options);
	const removeWorkspacesOf = vi.fn(async () => ok(undefined));
	const service = new RepoService({
		platform: platform.platform,
		git: git.git,
		repos: { repos: repos.api } as RepoServiceDeps["repos"],
		settings: {
			get: <T>(key: string) => prefs.get(key) as T,
			set: async (key: string, value: unknown) => {
				prefs.set(key, value);
				return ok(undefined);
			},
		} as unknown as RepoServiceDeps["settings"],
		removal: { removeWorkspacesOf, releaseBacklogOf: () => {} },
		ids: createTestIds(),
	});
	return { service, repos, git, prefs };
}

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

function seedCloneReplies(
	ctx: ReturnType<typeof makeService>,
	url: string,
	destination: string,
): void {
	const command = url.includes("github.com")
		? githubRepoClone(url, destination)
		: cloneWithProgress(url, destination);
	ctx.git.replies.set(commandKey(command), output(0, "", "Cloning into 'repo'...\n"));
	ctx.git.replies.set(commandKey(remoteGetUrl("origin")), output(0, url));
	ctx.git.replies.set(
		commandKey(symbolicRefRemoteHead("origin")),
		output(0, "refs/remotes/origin/main\n"),
	);
	ctx.git.replies.set(commandKey(branchShowCurrent()), output(0, "main\n"));
}

describe("PRJ-02 clone destinations", () => {
	it("names the folder from an HTTPS, SCP or SSH URL", () => {
		expect(repoNameFromUrl("https://github.com/octo/repo.git")).toBe("repo");
		expect(repoNameFromUrl("https://github.com/octo/repo/")).toBe("repo");
		expect(repoNameFromUrl("git@github.com:octo/repo.git")).toBe("repo");
		expect(repoNameFromUrl("ssh://git@ssh.github.com:443/octo/repo.git")).toBe("repo");
	});

	it("returns null when the URL names no folder", () => {
		expect(repoNameFromUrl("")).toBeNull();
		expect(repoNameFromUrl("not a url")).toBeNull();
		expect(repoNameFromUrl("https://github.com")).toBeNull();
	});

	it("joins a folder and a name with one slash", () => {
		expect(joinFolder("/code", "repo")).toBe("/code/repo");
		expect(joinFolder("/code/", "repo")).toBe("/code/repo");
		expect(joinFolder("/", "repo")).toBe("/repo");
	});
});

describe("PRJ-02 cloning from GitHub", () => {
	it("clones a github.com URL with gh repo clone and adds the project", async () => {
		const url = "https://github.com/octo/repo.git";
		const destination = "/code/repo";
		const ctx = makeService({ dirs: ["/code"] });
		seedCloneReplies(ctx, url, destination);

		const repo = must(await ctx.service.clone(url, "/code"));

		expect(repo.name).toBe("repo");
		expect(repo.rootPath).toBe(destination);
		expect(repo.remoteUrl).toBe(url);
		expect(repo.defaultBranch).toBe("main");
		expect(ctx.repos.rows).toHaveLength(1);
		expect(ctx.service.store.getState().order).toEqual([repo.id]);
		expect(
			ctx.git.calls.some(
				(command) => commandKey(command) === commandKey(githubRepoClone(url, destination)),
			),
		).toBe(true);
		expect(
			ctx.git.calls.some(
				(command) => commandKey(command) === commandKey(cloneWithProgress(url, destination)),
			),
		).toBe(false);
	});

	it("clones another host with git clone --progress instead of gh", async () => {
		const url = "https://gitlab.com/octo/repo.git";
		const destination = "/code/repo";
		const ctx = makeService({ dirs: ["/code"] });
		seedCloneReplies(ctx, url, destination);

		must(await ctx.service.clone(url, "/code"));

		expect(
			ctx.git.calls.some(
				(command) => commandKey(command) === commandKey(cloneWithProgress(url, destination)),
			),
		).toBe(true);
		expect(
			ctx.git.calls.some(
				(command) => commandKey(command) === commandKey(githubRepoClone(url, destination)),
			),
		).toBe(false);
	});

	it("checks out the default branch the remote names", async () => {
		const url = "https://github.com/octo/repo.git";
		const destination = "/code/repo";
		const ctx = makeService({ dirs: ["/code"] });
		seedCloneReplies(ctx, url, destination);
		ctx.git.replies.set(
			commandKey(symbolicRefRemoteHead("origin")),
			output(0, "refs/remotes/origin/develop\n"),
		);
		ctx.git.replies.set(commandKey(branchShowCurrent()), output(0, "feature\n"));

		const repo = must(await ctx.service.clone(url, "/code"));

		expect(repo.defaultBranch).toBe("develop");
		expect(
			ctx.git.calls.some((command) => commandKey(command) === commandKey(checkout("develop"))),
		).toBe(true);
	});

	it("shows the clone in progress, then its result", async () => {
		const url = "https://github.com/octo/repo.git";
		const destination = "/code/repo";
		const ctx = makeService({ dirs: ["/code"] });
		seedCloneReplies(ctx, url, destination);
		const seen: Array<CloneProgress | null | undefined> = [];
		ctx.git.onRunChecked = () => {
			seen.push(ctx.service.store.getState().cloneProgress);
		};

		must(await ctx.service.clone(url, "/code"));

		expect(seen[0]?.state).toBe("cloning");
		expect(seen[0]?.destination).toBe(destination);
		expect(ctx.service.store.getState().cloneProgress).toEqual({
			state: "done",
			url,
			destination,
			output: "",
		});
	});
});

describe("PRJ-02 where a clone goes by default, as in Conductor", () => {
	it("suggests the last clone folder while it still exists", async () => {
		const ctx = makeService({ dirs: ["/code"], settings: { last_clone_directory: "/code" } });
		expect(await ctx.service.defaultCloneDirectory()).toBe("/code");
	});

	it("suggests <root>/repos when there is no last folder or it is gone", async () => {
		expect(await makeService().service.defaultCloneDirectory()).toBe("/home/me/conducted/repos");
		const gone = makeService({ settings: { last_clone_directory: "/old/place" } });
		expect(await gone.service.defaultCloneDirectory()).toBe("/home/me/conducted/repos");
	});

	it("clones into a folder that does not exist yet, as git clone does", async () => {
		const url = "https://github.com/octo/repo.git";
		const ctx = makeService();
		seedCloneReplies(ctx, url, "/home/me/conducted/repos/repo");

		const repo = must(await ctx.service.clone(url, "/home/me/conducted/repos"));

		expect(repo.rootPath).toBe("/home/me/conducted/repos/repo");
	});

	it("remembers the folder of a clone that worked", async () => {
		const url = "https://github.com/octo/repo.git";
		const ctx = makeService({ dirs: ["/code"] });
		seedCloneReplies(ctx, url, "/code/repo");

		must(await ctx.service.clone(url, "/code"));

		expect(ctx.prefs.get("last_clone_directory")).toBe("/code");
	});
});

describe("PRJ-02 refusing a clone", () => {
	it("requires a URL and a folder", async () => {
		const ctx = makeService();
		const missingUrl = await ctx.service.clone("  ", "/code");
		const missingFolder = await ctx.service.clone("https://github.com/octo/repo.git", " ");

		expect(missingUrl.ok).toBe(false);
		if (!missingUrl.ok) expect(missingUrl.error.code).toBe("repo_url_missing");
		expect(missingFolder.ok).toBe(false);
		if (!missingFolder.ok) expect(missingFolder.error.code).toBe("repo_location_missing");
		expect(ctx.git.calls).toHaveLength(0);
	});

	it("refuses a URL that names no repository", async () => {
		const ctx = makeService({ dirs: ["/code"] });

		const result = await ctx.service.clone("not a url", "/code");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_url_invalid");
	});

	it("refuses a location that is missing and cannot be created", async () => {
		const ctx = makeService({ dirs: [], unwritable: ["/code"] });

		const result = await ctx.service.clone("https://github.com/octo/repo.git", "/code");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_location_missing");
	});

	it("refuses a destination folder that already exists", async () => {
		const ctx = makeService({ dirs: ["/code", "/code/repo"] });

		const result = await ctx.service.clone("https://github.com/octo/repo.git", "/code");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_destination_exists");
		expect(ctx.git.calls).toHaveLength(0);
	});

	it("reports a failed clone and adds no project", async () => {
		const url = "https://github.com/octo/repo.git";
		const destination = "/code/repo";
		const ctx = makeService({ dirs: ["/code"] });
		ctx.git.replies.set(
			commandKey(githubRepoClone(url, destination)),
			output(1, "", "fatal: repository not found"),
		);

		const result = await ctx.service.clone(url, "/code");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("git_failed");
		expect(ctx.repos.rows).toHaveLength(0);
		expect(ctx.service.store.getState().cloneProgress?.state).toBe("failed");
		expect(ctx.service.store.getState().cloneProgress?.output).toContain("not found");
	});

	it("fails when the new clone has no origin instead of storing a project without one", async () => {
		const url = "https://github.com/octo/repo.git";
		const destination = "/code/repo";
		const ctx = makeService({ dirs: ["/code"] });
		seedCloneReplies(ctx, url, destination);
		ctx.git.replies.set(commandKey(remoteGetUrl("origin")), output(128, "", "fatal: no remote"));

		const result = await ctx.service.clone(url, "/code");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_remote_missing");
		expect(ctx.repos.rows).toHaveLength(0);
	});

	it("reports a failed branch probe instead of skipping the default branch", async () => {
		const url = "https://github.com/octo/repo.git";
		const destination = "/code/repo";
		const ctx = makeService({ dirs: ["/code"] });
		seedCloneReplies(ctx, url, destination);
		ctx.git.replies.set(commandKey(branchShowCurrent()), output(128, "", "fatal: bad HEAD"));

		const result = await ctx.service.clone(url, "/code");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("git_failed");
		expect(ctx.repos.rows).toHaveLength(0);
		expect(ctx.service.store.getState().cloneProgress?.state).toBe("failed");
		expect(ctx.service.store.getState().cloneProgress?.output).toContain("bad HEAD");
	});

	it("answers with the project another clone stored when the insert races", async () => {
		const url = "https://github.com/octo/repo.git";
		const destination = "/code/repo";
		const ctx = makeService({ dirs: ["/code"] });
		seedCloneReplies(ctx, url, destination);
		const raced: Repo = {
			id: "repo-raced" as Repo["id"],
			name: "repo",
			rootPath: destination,
			remoteUrl: url,
			defaultBranch: "main",
			icon: null,
			displayOrder: 0,
			hidden: false,
			createdAt: 1000,
			updatedAt: 1000,
		};
		const realGetByRootPath = ctx.repos.api.getByRootPath.bind(ctx.repos.api);
		let lookups = 0;
		ctx.repos.api.getByRootPath = async (rootPath) => {
			if (rootPath !== destination) return realGetByRootPath(rootPath);
			lookups += 1;
			return ok(lookups === 1 ? null : raced);
		};
		ctx.repos.api.create = async () =>
			err(appError("db.conflict", "That folder is already a project."));

		const repo = must(await ctx.service.clone(url, "/code"));

		expect(repo.id).toBe(raced.id);
		expect(ctx.service.store.getState().reposById[raced.id]?.id).toBe(raced.id);
		expect(lookups).toBe(2);
	});
});

describe("PRJ-02 registering a folder", () => {
	it("uses the same race handling when a local folder is added", async () => {
		const ctx = makeService({ dirs: ["/code/app"] });
		ctx.git.replies.set(commandKey(revParse("--show-toplevel")), output(0, "/code/app\n"));
		ctx.git.replies.set(commandKey(branchShowCurrent()), output(0, "main\n"));
		const raced: Repo = {
			id: "repo-raced" as Repo["id"],
			name: "app",
			rootPath: "/code/app",
			remoteUrl: null,
			defaultBranch: "main",
			icon: null,
			displayOrder: 0,
			hidden: false,
			createdAt: 1000,
			updatedAt: 1000,
		};
		const realGetByRootPath = ctx.repos.api.getByRootPath.bind(ctx.repos.api);
		let lookups = 0;
		ctx.repos.api.getByRootPath = async (rootPath) => {
			if (rootPath !== "/code/app") return realGetByRootPath(rootPath);
			lookups += 1;
			return ok(lookups === 1 ? null : raced);
		};
		ctx.repos.api.create = async () =>
			err(appError("db.conflict", "That folder is already a project."));

		const repo = must(await ctx.service.addLocal("/code/app"));

		expect(repo.id).toBe(raced.id);
		expect(ctx.service.store.getState().reposById[raced.id]?.id).toBe(raced.id);
		expect(lookups).toBe(2);
	});
});
