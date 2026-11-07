/**
 * Puts one catalogue state's world on a real disk, for stage 2 of the reference run (live.ts): our
 * real shell then runs real git on real folders, where the catalogue's world only scripts the answers.
 *
 * - `relocate` moves every path of the catalogue's made-up Mac (its home, app data and temp folders)
 *   under the run's scratch folder: in rows, in JSON text inside rows, and in file paths.
 * - `plantOnDisk` builds each repository the world planted (`world.repos`, catalogue/git-repo.ts):
 *   a project's clone with a bare `origin` beside it in the scratch folder, each workspace as a
 *   worktree of its project on its own branch, the branch's commits (authored by the catalogue's
 *   person, at the description's times), its upstream ahead and behind, the target branch's commits
 *   the workspace lacks, and the changes left in the working tree. Files the world's disk holds go
 *   into the first commit when they sit in a repository and are not one of its changed files, and
 *   are written as they are everywhere else.
 * - Nothing reaches the network: every remote is a folder in the scratch folder, and git runs with
 *   no system or user configuration.
 *
 * What a description cannot say is chosen here and stays sample data: the first commit holds every
 * file of the project, a branch's committed changes go into its oldest commit (the newer ones are
 * empty), and commits the target branch has beyond a workspace are empty commits.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ScriptedFile, ScriptedRepo } from "../../apps/desktop/src/catalogue/git-repo.ts";

export interface Move {
	from: string;
	to: string;
}

const moveText = (text: string, moves: readonly Move[]): string => {
	let out = "";
	let index = 0;
	// Longest folder first, so an app data folder inside the home folder moves as a whole.
	const ordered = [...moves].sort((a, b) => b.from.length - a.from.length);
	while (index < text.length) {
		const move = ordered.find(
			(candidate) =>
				text.startsWith(candidate.from, index) &&
				!/[\w.-]/.test(text[index + candidate.from.length] ?? ""),
		);
		if (move === undefined) {
			out += text[index];
			index += 1;
		} else {
			out += move.to;
			index += move.from.length;
		}
	}
	return out;
};

/** The value with every folder of `moves` replaced where a path starts with it. */
export function relocate<T>(value: T, moves: readonly Move[]): T {
	if (typeof value === "string") return moveText(value, moves) as T;
	if (Array.isArray(value)) return value.map((item) => relocate(item, moves)) as T;
	if (value !== null && typeof value === "object" && !(value instanceof Uint8Array)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, relocate(item, moves)]),
		) as T;
	}
	return value;
}

export interface DiskPlan {
	/** The scratch folder; remotes go in `<root>/remotes`. */
	root: string;
	/** The home folder git runs with. */
	home: string;
	/** The world's repositories, already relocated. A later one for the same folder wins. */
	repos: readonly ScriptedRepo[];
	/** The world's files by absolute path, already relocated. */
	files: ReadonlyMap<string, string>;
	projects: readonly { path: string; defaultBranch: string }[];
	workspaces: readonly { path: string; projectPath: string }[];
	author: { name: string; email: string };
}

type Git = (cwd: string, args: string[], at?: number) => string;

function gitRunner(plan: DiskPlan): Git {
	return (cwd, args, at) => {
		const date = at === undefined ? undefined : `@${at} +0000`;
		const done = spawnSync("/usr/bin/git", args, {
			cwd,
			encoding: "utf8",
			env: {
				PATH: "/usr/bin:/bin",
				HOME: plan.home,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_AUTHOR_NAME: plan.author.name,
				GIT_AUTHOR_EMAIL: plan.author.email,
				GIT_COMMITTER_NAME: plan.author.name,
				GIT_COMMITTER_EMAIL: plan.author.email,
				...(date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
			},
		});
		if (done.status !== 0) {
			throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${done.stderr.trim()}`);
		}
		return done.stdout;
	};
}

const write = (path: string, text: string): void => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
};

const under = (path: string, folder: string): string | null =>
	path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : null;

/** The newest description of each folder, in first-planted order. */
function lastByPath(repos: readonly ScriptedRepo[]): Map<string, ScriptedRepo> {
	const byPath = new Map<string, ScriptedRepo>();
	for (const repo of repos) byPath.set(repo.path, repo);
	return byPath;
}

const isTracked = (file: ScriptedFile): boolean => file.status !== "untracked";

/** The texts a project's first commit holds: its own files, then what each workspace started from. */
function baseFiles(
	plan: DiskPlan,
	projectPath: string,
	workspaces: readonly ScriptedRepo[],
): Map<string, string> {
	const base = new Map<string, string>();
	const changed = new Set<string>();
	for (const workspace of workspaces) {
		for (const file of workspace.files) changed.add(`${workspace.path}/${file.path}`);
	}
	for (const [path, text] of plan.files) {
		if (changed.has(path)) continue;
		const own = under(path, projectPath);
		if (own !== null) base.set(own, text);
		for (const workspace of workspaces) {
			const relative = under(path, workspace.path);
			if (relative !== null) base.set(relative, text);
		}
	}
	for (const workspace of workspaces) {
		for (const file of workspace.files) {
			if (isTracked(file) && file.status !== "added") base.set(file.path, file.before);
		}
	}
	return base;
}

/** The time of the first commit: an hour before the oldest commit any of these repositories names. */
function baseTime(repos: readonly ScriptedRepo[], fallback: number): number {
	const times = repos.flatMap((repo) => repo.commits.map((commit) => commit.at));
	return times.length === 0 ? fallback : Math.min(...times) - 3_600;
}

function applyFiles(dir: string, files: readonly ScriptedFile[]): void {
	for (const file of files) {
		const path = join(dir, file.path);
		if (file.status === "deleted") rmSync(path, { force: true });
		else write(path, file.after);
	}
}

/** Commits, pushes and leaves the working tree of one branch the way its description says. */
function plantBranch(git: Git, dir: string, repo: ScriptedRepo, start: number): void {
	const committed = repo.files.filter((file) => isTracked(file) && file.committed);
	const oldestFirst = [...repo.commits].reverse();
	if (committed.length > 0 && oldestFirst.length === 0) {
		throw new Error(`${repo.path} has committed changes but no commits to hold them.`);
	}
	oldestFirst.forEach((commit, index) => {
		if (index === 0 && committed.length > 0) {
			applyFiles(dir, committed);
			git(dir, ["add", "--all", "--", ...committed.map((file) => file.path)]);
		}
		git(dir, ["commit", "--quiet", "--allow-empty", "-m", commit.subject], commit.at);
	});
	if (repo.upstream !== null) {
		const ahead = Math.min(repo.upstream.ahead, oldestFirst.length);
		const pushed = git(dir, ["rev-parse", `HEAD~${ahead}`]).trim();
		let tip = pushed;
		for (let index = 0; index < repo.upstream.behind; index++) {
			tip = git(
				dir,
				["commit-tree", `${tip}^{tree}`, "-p", tip, "-m", "Pushed from elsewhere"],
				start,
			).trim();
		}
		git(dir, ["push", "--quiet", "origin", `${tip}:refs/heads/${repo.branch}`]);
		git(dir, ["fetch", "--quiet", "origin"]);
		git(dir, ["branch", "--quiet", `--set-upstream-to=origin/${repo.branch}`]);
	}
	const loose = repo.files.filter((file) => !isTracked(file) || !file.committed);
	applyFiles(dir, loose);
	const added = loose.filter((file) => file.status === "added").map((file) => file.path);
	if (added.length > 0) git(dir, ["add", "--intent-to-add", "--", ...added]);
}

/** Builds every repository and file of the plan on disk. */
export function plantOnDisk(plan: DiskPlan, fallbackTime = 1_767_225_600): void {
	const git = gitRunner(plan);
	const byPath = lastByPath(plan.repos);
	const remotes = join(plan.root, "remotes");
	mkdirSync(remotes, { recursive: true });
	const planted = new Set<string>();

	for (const [index, project] of plan.projects.entries()) {
		const workspaces = plan.workspaces
			.filter((workspace) => workspace.projectPath === project.path)
			.map((workspace) => byPath.get(workspace.path))
			.filter((repo): repo is ScriptedRepo => repo !== undefined);
		const own = byPath.get(project.path);
		const start = baseTime([...workspaces, ...(own === undefined ? [] : [own])], fallbackTime);
		const branch = project.defaultBranch;
		const remote = join(remotes, `${index}-${basename(project.path)}.git`);
		mkdirSync(remote, { recursive: true });
		git(remote, ["init", "--quiet", "--bare", "-b", branch]);
		mkdirSync(project.path, { recursive: true });
		git(project.path, ["init", "--quiet", "-b", branch]);
		git(project.path, ["remote", "add", "origin", remote]);
		for (const [path, text] of baseFiles(plan, project.path, workspaces)) {
			write(join(project.path, path), text);
		}
		git(project.path, ["add", "--all"]);
		git(project.path, ["commit", "--quiet", "--allow-empty", "-m", "Initial commit"], start);
		git(project.path, ["push", "--quiet", "-u", "origin", branch]);
		planted.add(project.path);

		// A workspace that is behind the target starts before the target's newer commits.
		const behind = Math.max(0, ...workspaces.map((workspace) => workspace.behindTarget));
		let advanced = 0;
		for (const workspace of [...workspaces].sort((a, b) => b.behindTarget - a.behindTarget)) {
			while (advanced < behind - workspace.behindTarget) {
				advanced += 1;
				git(
					project.path,
					["commit", "--quiet", "--allow-empty", "-m", `Target commit ${advanced}`],
					start + advanced,
				);
				git(project.path, ["push", "--quiet", "origin", branch]);
			}
			mkdirSync(dirname(workspace.path), { recursive: true });
			git(project.path, [
				"worktree",
				"add",
				"--quiet",
				"-b",
				workspace.branch,
				workspace.path,
				branch,
			]);
			plantBranch(git, workspace.path, workspace, start);
			planted.add(workspace.path);
		}
		while (advanced < behind) {
			advanced += 1;
			git(
				project.path,
				["commit", "--quiet", "--allow-empty", "-m", `Target commit ${advanced}`],
				start + advanced,
			);
			git(project.path, ["push", "--quiet", "origin", branch]);
		}
	}

	// A planted folder that belongs to no project: its own clone, from its own remote.
	for (const [path, repo] of byPath) {
		if (planted.has(path)) continue;
		const remote = join(remotes, `${planted.size}-${basename(path)}.git`);
		const main = repo.target.replace(/^origin\//, "");
		mkdirSync(remote, { recursive: true });
		git(remote, ["init", "--quiet", "--bare", "-b", main]);
		mkdirSync(path, { recursive: true });
		git(path, ["init", "--quiet", "-b", main]);
		git(path, ["remote", "add", "origin", remote]);
		for (const [file, text] of baseFiles(plan, path, [repo])) write(join(path, file), text);
		git(path, ["add", "--all"]);
		const start = baseTime([repo], fallbackTime);
		git(path, ["commit", "--quiet", "--allow-empty", "-m", "Initial commit"], start);
		git(path, ["push", "--quiet", "-u", "origin", main]);
		if (repo.branch !== main) git(path, ["checkout", "--quiet", "-b", repo.branch]);
		plantBranch(git, path, repo, start);
		planted.add(path);
	}

	// Every other file of the world's disk, as it is.
	for (const [path, text] of plan.files) {
		if ([...planted].some((folder) => under(path, folder) !== null)) continue;
		write(path, text);
	}
}
