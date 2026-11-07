import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScriptedRepo } from "../../apps/desktop/src/catalogue/git-repo.ts";
import { plantOnDisk, relocate } from "./world-disk.ts";

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "world-disk-")));
	made.push(dir);
	return dir;
}

const git = (cwd: string, ...args: string[]): string => {
	const done = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { PATH: "/usr/bin:/bin", HOME: cwd, GIT_CONFIG_NOSYSTEM: "1" },
	});
	if (done.status !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
	return done.stdout;
};

describe("relocate", () => {
	test("moves every string that starts with a folder, inside objects and JSON text, longest first", () => {
		const moves = [
			{ from: "/Users/sam", to: "/tmp/x/home" },
			{ from: "/Users/sam/Library/Application Support/Conducted", to: "/tmp/x/data" },
		];
		expect(
			relocate(
				{
					root: "/Users/sam/code/atlas",
					config: JSON.stringify({ cwd: "/Users/sam/code/atlas/src" }),
					log: "/Users/sam/Library/Application Support/Conducted/logs/a.log",
					other: "/Users/samuel/notes",
					list: ["/Users/sam", 3, null],
				},
				moves,
			),
		).toEqual({
			root: "/tmp/x/home/code/atlas",
			config: JSON.stringify({ cwd: "/tmp/x/home/code/atlas/src" }),
			log: "/tmp/x/data/logs/a.log",
			other: "/Users/samuel/notes",
			list: ["/tmp/x/home", 3, null],
		});
	});
});

describe("plantOnDisk", () => {
	test("builds a project clone and a workspace worktree that git reads as the description says", () => {
		const root = scratch();
		const project = join(root, "home/code/atlas");
		const workspace = join(root, "home/workspaces/atlas/arbor");
		const repos: ScriptedRepo[] = [
			{
				path: project,
				branch: "main",
				target: "origin/main",
				files: [],
				commits: [],
				upstream: { ahead: 0, behind: 0 },
				behindTarget: 0,
			},
			{
				path: workspace,
				branch: "sam/arbor",
				target: "origin/main",
				files: [
					{ path: "src/a.ts", status: "modified", before: "a\n", after: "a\nb\n", committed: true },
					{ path: "src/new.ts", status: "added", before: "", after: "new\n", committed: false },
					{ path: "notes.md", status: "untracked", before: "", after: "draft\n", committed: false },
					{ path: "old.ts", status: "deleted", before: "old\n", after: "", committed: false },
				],
				commits: [
					{ sha: "s2", subject: "Second", at: 1_700_000_200 },
					{ sha: "s1", subject: "First", at: 1_700_000_100 },
				],
				upstream: { ahead: 1, behind: 0 },
				behindTarget: 2,
			},
		];
		const files = new Map([
			[`${project}/README.md`, "# Atlas\n"],
			[`${workspace}/src/a.ts`, "a\nb\n"],
			[`${workspace}/notes.md`, "draft\n"],
			[`${root}/home/Library/settings.json`, "{}\n"],
		]);
		plantOnDisk({
			root,
			home: join(root, "home"),
			repos,
			files,
			projects: [{ path: project, defaultBranch: "main" }],
			workspaces: [{ path: workspace, projectPath: project }],
			author: { name: "Sam Rivera", email: "sam@example.com" },
		});

		expect(git(project, "branch", "--show-current").trim()).toBe("main");
		expect(git(workspace, "branch", "--show-current").trim()).toBe("sam/arbor");
		expect(git(workspace, "rev-parse", "--git-common-dir").trim()).toBe(join(project, ".git"));
		expect(git(workspace, "log", "--format=%s|%an|%ae|%at", "origin/main..HEAD").trim()).toBe(
			"Second|Sam Rivera|sam@example.com|1700000200\nFirst|Sam Rivera|sam@example.com|1700000100",
		);
		expect(git(workspace, "rev-list", "--left-right", "--count", "HEAD...@{u}").trim()).toBe(
			"1\t0",
		);
		expect(git(workspace, "rev-list", "--count", "HEAD..origin/main").trim()).toBe("2");
		expect(git(workspace, "status", "--porcelain", "--untracked-files=all")).toBe(
			" D old.ts\n A src/new.ts\n?? notes.md\n",
		);
		expect(git(workspace, "show", "origin/main:README.md")).toBe("# Atlas\n");
		expect(git(workspace, "show", "HEAD:src/a.ts")).toBe("a\nb\n");
		expect(readFileSync(join(root, "home/Library/settings.json"), "utf8")).toBe("{}\n");
		expect(git(project, "status", "--porcelain")).toBe("");
		expect(existsSync(join(workspace, "old.ts"))).toBe(false);
	});

	/** One project with one workspace described by `workspace`. */
	function plantOne(workspace: Omit<ScriptedRepo, "path" | "target">): string {
		const root = scratch();
		const project = join(root, "home/code/atlas");
		const path = join(root, "home/workspaces/atlas/arbor");
		plantOnDisk({
			root,
			home: join(root, "home"),
			repos: [
				{
					path: project,
					branch: "main",
					target: "origin/main",
					files: [],
					commits: [],
					upstream: { ahead: 0, behind: 0 },
					behindTarget: 0,
				},
				{ ...workspace, path, target: "origin/main" },
			],
			files: new Map(),
			projects: [{ path: project, defaultBranch: "main" }],
			workspaces: [{ path, projectPath: project }],
			author: { name: "Sam Rivera", email: "sam@example.com" },
		});
		return path;
	}

	test("leaves a workspace described with no branch on a detached HEAD", () => {
		const workspace = plantOne({
			branch: "",
			files: [],
			commits: [{ sha: "s1", subject: "First", at: 1_700_000_100 }],
			upstream: { ahead: 0, behind: 0 },
			behindTarget: 0,
		});

		expect(git(workspace, "branch", "--show-current").trim()).toBe("");
		expect(git(workspace, "log", "--format=%s", "origin/main..HEAD").trim()).toBe("First");
	});

	test("force-pushes the remote branch of a workspace whose remote was rewritten", () => {
		const workspace = plantOne({
			branch: "sam/arbor",
			files: [],
			commits: [
				{ sha: "s2", subject: "Second", at: 1_700_000_200 },
				{ sha: "s1", subject: "First", at: 1_700_000_100 },
			],
			upstream: { ahead: 1, behind: 2 },
			behindTarget: 0,
			remoteRewritten: true,
		});

		expect(git(workspace, "rev-list", "--left-right", "--count", "HEAD...@{u}").trim()).toBe(
			"1\t2",
		);
		const head = git(workspace, "rev-parse", "HEAD").trim();
		const reflog = git(workspace, "reflog", "show", "--format=%H", "refs/remotes/origin/sam/arbor");
		expect(reflog.split("\n")).toContain(head);
	});
});
