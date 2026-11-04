/**
 * @feature WS-01 Worktree creation and removal
 * Owns: the git steps that create a workspace's worktree, set it up, and remove it again, plus
 * the rule that makes a branch or folder name unique.
 * Behaviour: services-map.md 3.1 (workspace create), 3.13 (worktree-level config), 3.10 (archive
 * and unarchive), 3.15 (minimal command set).
 * Must handle: a repository with no commit yet (create an empty initial commit first); fetch
 * failures (no remote, no network: fall back to the cached remote ref and tell the user; a local
 * default branch when there is no remote at all); a post-checkout hook that fails after the
 * worktree exists (downgrade to a warning); a branch name already used locally, on the remote or
 * by an open or merged PR (suffix -v1, -v2, up to 1000 tries); `core.worktree` or `core.bare` set
 * (do not enable worktree config); `.context/` is excluded in the shared `info/exclude`, not in
 * `.gitignore`; removal falls back to trashing the folder and `worktree prune`.
 * Our design choice: the base is always a commit id, never a ref name, so the worktree starts
 * from exactly what was fetched. Removal of the folder goes through the Trash (fs.trash).
 * Test first: nextFreeName("oslo", taken: oslo, oslo-v1) returns "oslo-v2".
 */
import { appError, err, notImplemented, ok, type Result } from "@conducted/shared";
import type { FileSystem } from "../../platform/platform.ts";
import type { GitRunner } from "./runner.ts";

export const MAX_NAME_SUFFIX_TRIES = 1000;

/**
 * Returns `base`, or `base-v1`, `base-v2`, ... until `isTaken` says the name is free.
 * Gives up with an error after 1000 tries.
 */
export async function nextFreeName(
	base: string,
	isTaken: (candidate: string) => Promise<boolean>,
): Promise<Result<string>> {
	if (!(await isTaken(base))) return ok(base);
	for (let n = 1; n <= MAX_NAME_SUFFIX_TRIES; n++) {
		const candidate = `${base}-v${n}`;
		if (!(await isTaken(candidate))) return ok(candidate);
	}
	return err(appError("name_exhausted", `No free name found for "${base}".`));
}

export interface CreateWorktreeInput {
	repoRootPath: string;
	remote: string;
	baseBranch: string;
	newBranch: string;
	worktreePath: string;
	/** Allow a local branch as the base when the repository has no usable remote. */
	allowLocalBase: boolean;
}

export interface CreatedWorktree {
	headSha: string;
	/** Set when the user should hear about something, for example an offline fetch fallback. */
	warning: string | null;
}

/** Steps of services-map 3.1: empty-HEAD guard, fetch, resolve the base id, `worktree add`. */
export function createWorktree(
	_runner: GitRunner,
	_input: CreateWorktreeInput,
): Promise<Result<CreatedWorktree>> {
	return notImplemented("WS-01");
}

/** Steps of services-map 3.13 and 3.1: worktree config, `.context` exclude. */
export function prepareWorktree(
	_runner: GitRunner,
	_input: { repoRootPath: string; worktreePath: string; autoSetupUpstream: boolean },
): Promise<Result<{ warning: string | null }>> {
	return notImplemented("WS-01");
}

/** Removes the worktree, falling back to the Trash and `worktree prune` (services-map 3.10). */
export function removeWorktree(
	_runner: GitRunner,
	_fs: FileSystem,
	_input: { repoRootPath: string; worktreePath: string },
): Promise<Result<void>> {
	return notImplemented("WS-05");
}

/** True when the name exists as a local branch or a remote-tracking branch. */
export function branchNameIsTaken(
	_runner: GitRunner,
	_input: { repoRootPath: string; remote: string; name: string },
): Promise<boolean> {
	return notImplemented("WS-01");
}
