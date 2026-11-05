/**
 * @feature GIT-09 Rename the branch
 * Owns: the rules that decide whether a branch name may be used, the next free name when it may
 * not, and the git branch rename itself.
 * Behaviour: services-map.md 3.11 (rename under the worktree lock; availability checked with
 * `show-ref`, the remote branch list and open or merged pull requests; `-v2`, `-v3` suffixes),
 * and inventory toast row 456 (a detached HEAD gets a plain message instead of git's error).
 * Must handle: a detached HEAD gives "Please check out a branch before renaming."; a name already
 * used locally, on the remote or by an open or merged pull request takes the next `-vN` suffix; a
 * repository with no GitHub remote skips the pull request check; a failed `gh` call is returned,
 * never read as "no pull requests"; 1000 suffixes are tried before giving up.
 * Our design choice: rename keeps the old remote branch; the app never deletes or force-pushes it
 * here. The suffix loop stays local because the workspace creator's `nextFreeName` starts at `-v1`
 * and cannot bump a name that is already `-vN` (services-map 3.1 against 3.11).
 * Not built here: renaming the workspace folder and its short-lived symlink need file operations
 * and a workspace path that can change; the warning that the old remote branch remains is shown by
 * the workspace header.
 * Test first: a name with an open pull request becomes name-v2.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { isGithubRemoteUrl } from "../services/github.ts";
import { branchRename, branchShowCurrent, remoteGetUrl } from "./commands.ts";
import { prListForBranch } from "./gh-commands.ts";
import type { GitRunner } from "./runner.ts";
import { branchNameIsTaken, MAX_NAME_SUFFIX_TRIES } from "./worktree.ts";

/** Shown when `git branch --show-current` prints nothing, for a detached HEAD. */
export const NO_BRANCH_CHECKED_OUT_MESSAGE = "Please check out a branch before renaming.";

export interface BranchNameQuery {
	/** The repository root, where local and remote refs are visible. */
	repoRootPath: string;
	remote: string;
	name: string;
}

/** Splits a name that already ends in `-vN`; otherwise the whole name is the prefix. */
export function branchSuffixOf(name: string): { prefix: string; next: number } {
	const match = /^(.*)-v(\d+)$/.exec(name);
	if (match === null) return { prefix: name, next: 2 };
	return { prefix: match[1] ?? name, next: Number(match[2]) + 1 };
}

/**
 * The base name, or the first free `-vN` name. The suffix starts at 2, as Conductor's rule does,
 * and a name that is already suffixed moves to the next number.
 */
export async function nextFreeBranchName(
	base: string,
	isTaken: (candidate: string) => Promise<Result<boolean>>,
): Promise<Result<string>> {
	const first = await isTaken(base);
	if (!first.ok) return first;
	if (!first.value) return ok(base);
	const { prefix, next } = branchSuffixOf(base);
	for (let suffix = next; suffix <= MAX_NAME_SUFFIX_TRIES; suffix += 1) {
		const candidate = `${prefix}-v${suffix}`;
		const taken = await isTaken(candidate);
		if (!taken.ok) return taken;
		if (!taken.value) return ok(candidate);
	}
	return err(appError("name_exhausted", `No free branch name was found for "${base}".`));
}

/** Whether a local branch, a remote-tracking branch, or an open or merged PR uses `name`. */
export async function branchNameTaken(
	git: GitRunner,
	query: BranchNameQuery,
): Promise<Result<boolean>> {
	if (await branchNameIsTaken(git, query)) return ok(true);

	const cwd = query.repoRootPath;
	// A repository with no remote, or a remote that is not GitHub, cannot have a pull request.
	const url = await git.run(remoteGetUrl(query.remote), { cwd });
	if (!url.ok) return url;
	if (url.value.exitCode !== 0 || !isGithubRemoteUrl(url.value.stdout)) return ok(false);

	const listed = await git.stdout(prListForBranch(query.name), { cwd });
	if (!listed.ok) return listed;
	let states: unknown;
	try {
		states = JSON.parse(listed.value === "" ? "[]" : listed.value);
	} catch (cause) {
		return err(appError("git_parse", "Couldn't read the pull request list for the branch.", cause));
	}
	if (!Array.isArray(states)) {
		return err(appError("git_parse", "Couldn't read the pull request list for the branch."));
	}
	return ok(
		states.some(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				"state" in entry &&
				(entry.state === "OPEN" || entry.state === "MERGED"),
		),
	);
}

/** The next free branch name after checking refs and pull requests. */
export function freeBranchName(
	git: GitRunner,
	input: { repoRootPath: string; remote: string; base: string },
): Promise<Result<string>> {
	return nextFreeBranchName(input.base, (candidate) =>
		branchNameTaken(git, {
			repoRootPath: input.repoRootPath,
			remote: input.remote,
			name: candidate,
		}),
	);
}

export interface RenameInWorktreeInput {
	worktreePath: string;
	repoRootPath: string;
	remote: string;
	requestedName: string;
	/** Saves the renamed branch in the workspace row and store. Called under the same lock. */
	onRenamed: (branch: string) => Promise<Result<void>>;
}

/**
 * Reads the checked-out branch, finds a free name, renames, and saves, all under one worktree
 * lock. A failed save renames the branch back, so the worktree and the workspace row agree.
 */
export async function renameBranchInWorktree(
	git: GitRunner,
	input: RenameInWorktreeInput,
): Promise<Result<void>> {
	return git.withWorktreeLock(input.worktreePath, async () => {
		const read = await git.stdout(branchShowCurrent(), { cwd: input.worktreePath });
		if (!read.ok) return read;
		const oldBranch = read.value.trim();
		if (oldBranch === "") {
			return err(appError("git_no_branch_checked_out", NO_BRANCH_CHECKED_OUT_MESSAGE));
		}
		if (oldBranch === input.requestedName) return ok(undefined);

		const free = await freeBranchName(git, {
			repoRootPath: input.repoRootPath,
			remote: input.remote,
			base: input.requestedName,
		});
		if (!free.ok) return free;
		const newBranch = free.value;

		const renamed = await git.runChecked(branchRename(oldBranch, newBranch), {
			cwd: input.worktreePath,
		});
		if (!renamed.ok) return renamed;

		const saved = await input.onRenamed(newBranch);
		if (saved.ok) return ok(undefined);
		const restored = await git.runChecked(branchRename(newBranch, oldBranch), {
			cwd: input.worktreePath,
		});
		return restored.ok
			? saved
			: err(appError(saved.error.code, saved.error.message, restored.error));
	});
}
