/**
 * @feature WS-01 Worktree creation and removal; WS-05 archive snapshot and pin; WS-06 unarchive
 * @feature WS-02 Create from a branch, PR or issue
 * Owns: the git steps that create a workspace's worktree, set it up, and remove it again; the base
 * branch fetch and commit resolution, including a commit already resolved by the caller; the
 * archive snapshot, its discard repair, the HEAD pin, and the removal fallback; plus the rule that
 * makes a branch or folder name unique.
 * Behaviour: services-map.md 3.1 (workspace create), 3.13 (worktree-level config), 3.10 (archive
 * and unarchive), 3.15 (minimal command set).
 * Must handle: a repository with no commit yet (create an empty initial commit first); fetch
 * failures (no remote, no network: fall back to the cached remote ref and tell the user; a local
 * default branch when there is no remote at all); a post-checkout hook that fails after the
 * worktree exists (downgrade to a warning); a branch name already used locally or on the remote
 * (suffix -v1, -v2, up to 1000 tries; services-map 3.1 checks these two, not pull requests);
 * `core.worktree` or `core.bare` set (do not enable worktree config); `.context/` is excluded in
 * the shared `info/exclude`, not in `.gitignore`, and a repository with no `info` folder gets one
 * (issue #600); removal falls back to trashing the folder and
 * `worktree prune`.
 * Our design choice: the base is always a commit id, never a ref name, so the worktree starts
 * from exactly what was fetched. Removal of the folder goes through the Trash (fs.trash).
 * Test first: nextFreeName("oslo", taken: oslo, oslo-v1) returns "oslo-v2".
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { FileSystem } from "../../platform/platform.ts";
import { contextDir } from "../app-paths.ts";
import {
	addUpdatedPaths,
	branchCreate,
	checkpointerRestore,
	commitEmptyInitial,
	configGetLocal,
	configGetWorktree,
	diffUnmergedPathsNul,
	enablePushAutoSetupRemote,
	enableWorktreeConfig,
	fetchBranchRefspec,
	revParse,
	revParseGitCommonDir,
	revParseGitPath,
	revParseHead,
	showRefVerify,
	updateRef,
	worktreeAddExistingBranch,
	worktreeAddNewBranch,
	worktreeList,
	worktreePrune,
	worktreeRemove,
} from "./commands.ts";
import { archiveCheckpointId, archiveRef, CHECKPOINTER_EXIT } from "./refs.ts";
import { failedCommandError, type GitRunner } from "./runner.ts";

export const MAX_NAME_SUFFIX_TRIES = 1000;

/** Shown after an offline fetch falls back to the cached remote ref (services-map 3.1). */
export const OFFLINE_FALLBACK_MESSAGE =
	"Couldn't fetch remote updates. Creating the workspace from the latest local revision.";

/** Shown when the worktree config steps are skipped (services-map 3.13). */
export const WORKTREE_CONFIG_SKIPPED_MESSAGE =
	"Couldn't configure Git push upstream settings. PR info may be less reliable until this branch has an upstream.";

export const BRANCH_AUTH_MESSAGE =
	"Git asked for credentials that are not available. Sign in to the remote, then try again.";

export const BRANCH_CLASH_MESSAGE =
	"Git won't let the app create that branch because another branch with a similar name already exists. Rename or delete it, or change the branch prefix in settings.";

/** Shown when the Mac is offline and the repository has no cached copy of the base branch. */
export const OFFLINE_NO_CACHE_MESSAGE =
	"Couldn't reach the Git remote, and there is no cached copy of the base branch to use instead.";

/** Git's messages for a repository whose HEAD has no commit yet. Anything else is a real failure. */
const UNBORN_HEAD_PATTERN =
	/ambiguous argument 'HEAD'|unknown revision|Needed a single revision|does not have any commits yet|bad revision 'HEAD'|unborn branch/i;

const join = (left: string, right: string): string =>
	`${left.replace(/\/+$/, "")}/${right.replace(/^\/+/, "")}`;

/**
 * Returns `base`, or `base-v1`, `base-v2`, ... until `isTaken` says the name is free.
 * A check that fails ends the search with its error. Gives up with an error after 1000 tries.
 */
export async function nextFreeName(
	base: string,
	isTaken: (candidate: string) => Promise<Result<boolean>>,
): Promise<Result<string>> {
	const first = await isTaken(base);
	if (!first.ok) return first;
	if (!first.value) return ok(base);
	for (let n = 1; n <= MAX_NAME_SUFFIX_TRIES; n++) {
		const candidate = `${base}-v${n}`;
		const taken = await isTaken(candidate);
		if (!taken.ok) return taken;
		if (!taken.value) return ok(candidate);
	}
	return err(appError("name_exhausted", `No free name found for "${base}".`));
}

export type FetchFailureKind = "remoteMissing" | "baseMissing" | "offline" | "auth" | "other";

/** Reads the fetch error the way services-map 3.1 splits its answers. */
export function classifyFetchError(stderr: string): FetchFailureKind {
	if (/does not appear to be a git repository|No such remote|no such remote/i.test(stderr))
		return "remoteMissing";
	if (/couldn't find remote ref|could not find remote ref/i.test(stderr)) return "baseMissing";
	if (
		/could not read Username|Device not configured|Authentication failed|Permission denied/i.test(
			stderr,
		)
	)
		return "auth";
	if (
		/Could not resolve host|Network is unreachable|Temporary failure in name resolution|Operation timed out|Connection timed out|Connection refused/i.test(
			stderr,
		)
	)
		return "offline";
	return "other";
}

/** True when git refused a branch because another ref with a prefix of its name exists. */
export const isBranchClash = (stderr: string): boolean =>
	/cannot lock ref 'refs\/heads\/.+': 'refs\/heads\/.+'.*exists/i.test(stderr);

/** The message shown for a branch name clash such as `alex` and `alex/oslo`. */
export const branchClashMessage = (stderr: string): string =>
	isBranchClash(stderr) ? BRANCH_CLASH_MESSAGE : stderr.trim();

export interface CreateWorktreeInput {
	repoRootPath: string;
	remote: string;
	baseBranch: string;
	newBranch: string;
	worktreePath: string;
	/** Allow a local branch as the base when the repository has no usable remote. */
	allowLocalBase: boolean;
	/** A commit already resolved for the base. Skips the fetch. */
	baseSha?: string;
}

export interface CreatedWorktree {
	headSha: string;
	/** Set when the user should hear about something, for example an offline fetch fallback. */
	warning: string | null;
}

export interface ResolveBaseInput {
	repoRootPath: string;
	remote: string;
	baseBranch: string;
	/** Allow a local branch as the base when the repository has no usable remote. */
	allowLocalBase: boolean;
}

export interface ResolvedBaseCommit {
	baseSha: string;
	warning: string | null;
}

/**
 * Fetches the base branch and resolves its commit id, with services-map 3.1's offline and
 * local-branch fallbacks. A caller that already resolved a commit skips this step.
 */
export async function resolveBaseCommit(
	runner: GitRunner,
	input: ResolveBaseInput,
): Promise<Result<ResolvedBaseCommit>> {
	const cwd = input.repoRootPath;
	let warning: string | null = null;
	let baseSha: string | null = null;
	const fetched = await runner.runChecked(fetchBranchRefspec(input.remote, input.baseBranch), {
		cwd,
	});
	if (fetched.ok) {
		const resolved = await runner.stdout(
			revParse(`refs/remotes/${input.remote}/${input.baseBranch}`),
			{
				cwd,
			},
		);
		if (!resolved.ok) {
			return err(
				appError(
					"git_base_missing",
					`Couldn't find ${input.remote}/${input.baseBranch}.`,
					resolved.error,
				),
			);
		}
		baseSha = resolved.value;
	} else {
		const failure = classifyFetchError(fetched.error.message);
		if (failure === "offline" || failure === "auth") {
			const cached = await runner.stdout(
				revParse(`refs/remotes/${input.remote}/${input.baseBranch}`),
				{ cwd },
			);
			if (cached.ok && cached.value !== "") {
				baseSha = cached.value;
				warning = OFFLINE_FALLBACK_MESSAGE;
			} else if (failure === "auth") {
				return err(appError("git_auth_required", BRANCH_AUTH_MESSAGE, fetched.error));
			} else {
				return err(appError("git_offline", OFFLINE_NO_CACHE_MESSAGE, fetched.error));
			}
		} else if (input.allowLocalBase && (failure === "remoteMissing" || failure === "baseMissing")) {
			const local = await runner.stdout(revParse(`refs/heads/${input.baseBranch}`), { cwd });
			if (local.ok && local.value !== "") baseSha = local.value;
		}
		if (baseSha === null) {
			if (failure === "remoteMissing") {
				return err(
					appError("git_remote_missing", `Couldn't find remote "${input.remote}".`, fetched.error),
				);
			}
			if (failure === "baseMissing") {
				return err(
					appError(
						"git_base_missing",
						`Couldn't find ${input.remote}/${input.baseBranch}.`,
						fetched.error,
					),
				);
			}
			return err(appError("git_fetch_failed", fetched.error.message, fetched.error));
		}
	}
	return baseSha === null
		? err(appError("git_base_missing", "The base commit could not be resolved."))
		: ok({ baseSha, warning });
}

/**
 * True when the worktree list names `path`, which tells a hook failure from a real one.
 * `git worktree list` prints real paths, so a symlinked workspaces root is resolved from inside
 * the new folder before comparing.
 */
async function worktreeExists(
	runner: GitRunner,
	repoRootPath: string,
	path: string,
): Promise<boolean> {
	const listed = await runner.stdout(worktreeList(), { cwd: repoRootPath });
	if (!listed.ok) return false;
	const paths = listed.value
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice("worktree ".length));
	if (paths.includes(path)) return true;
	const real = await runner.stdout(revParse("--show-toplevel"), { cwd: path });
	return real.ok && real.value !== "" && paths.includes(real.value);
}

/** Steps of services-map 3.1: empty-HEAD guard, fetch, resolve the base id, `worktree add`. */
export async function createWorktree(
	runner: GitRunner,
	input: CreateWorktreeInput,
): Promise<Result<CreatedWorktree>> {
	const cwd = input.repoRootPath;
	const head = await runner.runChecked(revParseHead(), { cwd });
	if (!head.ok) {
		if (!UNBORN_HEAD_PATTERN.test(head.error.message)) return head;
		const committed = await runner.runChecked(commitEmptyInitial(), { cwd });
		if (!committed.ok) return committed;
	}

	let warning: string | null = null;
	let baseSha = input.baseSha ?? null;
	if (baseSha === null) {
		const resolved = await resolveBaseCommit(runner, input);
		if (!resolved.ok) return resolved;
		baseSha = resolved.value.baseSha;
		warning = resolved.value.warning;
	}

	const added = await runner.runChecked(
		worktreeAddNewBranch(input.worktreePath, input.newBranch, baseSha),
		{ cwd },
	);
	if (!added.ok) {
		if (!(await worktreeExists(runner, cwd, input.worktreePath))) {
			return err(
				appError("git_worktree_failed", branchClashMessage(added.error.message), added.error),
			);
		}
		warning = `Worktree created at ${input.worktreePath}, but the post-checkout hook failed.`;
	}

	const headSha = await runner.stdout(revParseHead(), { cwd: input.worktreePath });
	return ok({ headSha: headSha.ok ? headSha.value : baseSha, warning });
}

export interface PrepareWorktreeInput {
	repoRootPath: string;
	worktreePath: string;
	autoSetupUpstream: boolean;
	fs: Pick<FileSystem, "exists" | "mkdirp" | "readText" | "writeTextAtomic">;
}

/** Steps of services-map 3.13 and 3.1: worktree config, `.context` folder and exclude. */
export async function prepareWorktree(
	runner: GitRunner,
	input: PrepareWorktreeInput,
): Promise<Result<{ warning: string | null }>> {
	let warning: string | null = null;

	const coreWorktree = await runner.stdout(configGetLocal("core.worktree"), {
		cwd: input.repoRootPath,
	});
	const coreBare = await runner.stdout(configGetLocal("core.bare"), {
		cwd: input.repoRootPath,
	});
	const sharedConfigBlocks = coreWorktree.ok && coreWorktree.value !== "";
	const isBare = coreBare.ok && coreBare.value === "true";

	if (sharedConfigBlocks || isBare) {
		const upstream = await runner.stdout(configGetWorktree("push.autoSetupRemote"), {
			cwd: input.worktreePath,
		});
		if (!(upstream.ok && upstream.value === "true")) warning = WORKTREE_CONFIG_SKIPPED_MESSAGE;
	} else {
		const enabled = await runner.runChecked(enableWorktreeConfig(), {
			cwd: input.repoRootPath,
		});
		if (!enabled.ok) {
			warning = WORKTREE_CONFIG_SKIPPED_MESSAGE;
		} else if (input.autoSetupUpstream) {
			const upstream = await runner.runChecked(enablePushAutoSetupRemote(), {
				cwd: input.worktreePath,
			});
			if (!upstream.ok) warning = WORKTREE_CONFIG_SKIPPED_MESSAGE;
		}
	}

	const context = await addContextFolder(runner, input);
	if (!context.ok) return context;
	return ok({ warning });
}

/**
 * Makes the checkout's `.context` folder and keeps it out of git through the repository's
 * `info/exclude` (services-map 3.1). A worktree and a cloud workspace's clone both use it.
 */
export async function addContextFolder(
	runner: GitRunner,
	input: Pick<PrepareWorktreeInput, "worktreePath" | "fs">,
): Promise<Result<void>> {
	const folder = contextDir(input.worktreePath);
	const made = await input.fs.mkdirp(folder);
	if (!made.ok) return made;

	const commonDir = await runner.stdout(revParseGitCommonDir(), { cwd: input.worktreePath });
	if (!commonDir.ok) return commonDir;
	if (commonDir.value === "") {
		return err(appError("git_parse", "git rev-parse --git-common-dir printed nothing."));
	}
	const resolvedCommonDir = commonDir.value.startsWith("/")
		? commonDir.value
		: join(input.worktreePath, commonDir.value);
	const excludePath = join(resolvedCommonDir, "info/exclude");
	const current = await input.fs.readText(excludePath);
	if (!current.ok && current.error.code !== "fs_not_found") return current;
	const text = current.ok ? current.value : "";
	if (!text.split("\n").includes(".context/")) {
		const next =
			text.length === 0 || text.endsWith("\n") ? `${text}.context/\n` : `${text}\n.context/\n`;
		// A repository made without git's templates has no `info` folder, and the write does not
		// make one (issue #600).
		const info = await input.fs.mkdirp(join(resolvedCommonDir, "info"));
		if (!info.ok) return info;
		const written = await input.fs.writeTextAtomic(excludePath, next);
		if (!written.ok) return written;
	}
	return ok(undefined);
}

/** Shown when a checkpoint save finds an unfinished merge, rebase, cherry-pick or revert. */
export const ARCHIVE_GIT_BUSY_MESSAGE =
	"Git has an unfinished merge, rebase, cherry-pick or revert. Finish it, or discard it and archive again.";

/** Git's in-progress operation files and folders, removed by the discard step (services-map 3.10). */
export const GIT_OPERATION_PATHS = [
	"MERGE_HEAD",
	"MERGE_MSG",
	"MERGE_MODE",
	"AUTO_MERGE",
	"SQUASH_MSG",
	"CHERRY_PICK_HEAD",
	"REVERT_HEAD",
	"REBASE_HEAD",
	"rebase-merge",
	"rebase-apply",
	"sequencer",
] as const;

const checkpointerSave = (checkpointerPath: string, id: string) => ({
	program: checkpointerPath,
	args: ["save", "--id", id, "--force"],
});

const absoluteGitPath = (worktreePath: string, path: string): string =>
	path.startsWith("/") ? path : `${worktreePath.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

/**
 * Resolves the unmerged paths and removes the leftover git operation files, so a checkpoint save
 * can run (services-map 3.10). The caller asks the user first.
 */
export async function discardGitOperationState(
	runner: GitRunner,
	fs: Pick<FileSystem, "exists" | "trash">,
	worktreePath: string,
): Promise<Result<void>> {
	const listed = await runner.run(diffUnmergedPathsNul(), { cwd: worktreePath });
	if (!listed.ok) return listed;
	const paths = listed.value.stdout.split("\0").filter((path) => path !== "");
	if (paths.length > 0) {
		const staged = await runner.runChecked(addUpdatedPaths(paths), { cwd: worktreePath });
		if (!staged.ok) return staged;
	}
	for (const name of GIT_OPERATION_PATHS) {
		const gitPath = await runner.stdout(revParseGitPath(name), { cwd: worktreePath });
		if (!gitPath.ok) return gitPath;
		if (gitPath.value === "") continue;
		const path = absoluteGitPath(worktreePath, gitPath.value);
		const found = await fs.exists(path);
		if (!found.ok) return found;
		if (!found.value) continue;
		const removed = await fs.trash(path);
		if (!removed.ok) return removed;
	}
	return ok(undefined);
}

export interface SaveArchiveSnapshotInput {
	workspaceId: string;
	checkpointerPath: string;
	worktreePath: string;
	/** The user agreed to discard a merge, rebase, cherry-pick or revert the save found. */
	discardGitOperationState: boolean;
	fs: Pick<FileSystem, "exists" | "trash">;
}

/**
 * Saves the workspace's uncommitted state under the archive id (services-map 3.10). A save that
 * reports an unfinished git operation is refused unless the caller passes the discard agreement;
 * with it, the operation state is discarded and the save is tried once more.
 */
export async function saveArchiveSnapshot(
	runner: GitRunner,
	input: SaveArchiveSnapshotInput,
): Promise<Result<{ discarded: boolean }>> {
	const command = checkpointerSave(input.checkpointerPath, archiveCheckpointId(input.workspaceId));
	const first = await runner.run(command, { cwd: input.worktreePath });
	if (!first.ok) return first;
	if (first.value.exitCode === 0) return ok({ discarded: false });
	if (
		first.value.exitCode !== CHECKPOINTER_EXIT.busy &&
		first.value.exitCode !== CHECKPOINTER_EXIT.unmergedIndex
	) {
		return err(
			appError(
				"archive_snapshot_failed",
				first.value.stderr.trim() || "Couldn't save the workspace before archiving.",
			),
		);
	}
	if (!input.discardGitOperationState) {
		return err(appError("archive_git_busy", ARCHIVE_GIT_BUSY_MESSAGE));
	}
	const discarded = await discardGitOperationState(runner, input.fs, input.worktreePath);
	if (!discarded.ok) return discarded;
	const retry = await runner.run(command, { cwd: input.worktreePath });
	if (!retry.ok) return retry;
	if (retry.value.exitCode !== 0) {
		return err(
			appError(
				"archive_snapshot_failed",
				retry.value.stderr.trim() || "Couldn't save the workspace before archiving.",
			),
		);
	}
	return ok({ discarded: true });
}

/** Reads HEAD and pins it under the workspace's archive ref (services-map 3.10). */
export async function pinArchiveHead(
	runner: GitRunner,
	workspaceId: string,
	worktreePath: string,
): Promise<Result<string>> {
	const head = await runner.stdout(revParseHead(), { cwd: worktreePath });
	if (!head.ok) return head;
	if (head.value === "") {
		return err(appError("git_parse", "git rev-parse HEAD printed nothing."));
	}
	const pinned = await runner.runChecked(updateRef(archiveRef(workspaceId), head.value), {
		cwd: worktreePath,
	});
	return pinned.ok ? ok(head.value) : pinned;
}

/** The branches `git worktree list --porcelain` reports, as full ref names. */
export function worktreeBranches(porcelain: string): string[] {
	return porcelain
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("branch "))
		.map((line) => line.slice("branch ".length));
}

export interface BranchState {
	exists: boolean;
	tip: string | null;
	/** True when another worktree has the branch checked out (services-map 3.10). */
	checkedOutElsewhere: boolean;
}

/** Reads what unarchive needs to classify a branch: its existence, tip and checkout (3.10). */
export async function readBranchState(
	runner: GitRunner,
	repoRootPath: string,
	branch: string,
): Promise<Result<BranchState>> {
	const found = await runner.run(showRefVerify(`refs/heads/${branch}`), { cwd: repoRootPath });
	if (!found.ok) return found;
	const exists = found.value.exitCode === 0;
	let tip: string | null = null;
	if (exists) {
		const resolved = await runner.stdout(revParse(`refs/heads/${branch}`), { cwd: repoRootPath });
		if (!resolved.ok) return resolved;
		tip = resolved.value === "" ? null : resolved.value;
	}
	const listed = await runner.stdout(worktreeList(), { cwd: repoRootPath });
	if (!listed.ok) return listed;
	return ok({
		exists,
		tip,
		checkedOutElsewhere: worktreeBranches(listed.value).includes(`refs/heads/${branch}`),
	});
}

export interface AddWorktreeOnBranchInput {
	repoRootPath: string;
	worktreePath: string;
	branch: string;
	/** The commit a missing branch is created from. Null reuses an existing branch. */
	createFrom: string | null;
}

/** Adds a worktree on an existing branch, or creates the branch from `createFrom` first (3.10). */
export async function addWorktreeOnBranch(
	runner: GitRunner,
	input: AddWorktreeOnBranchInput,
): Promise<Result<void>> {
	if (input.createFrom !== null) {
		const created = await runner.runChecked(branchCreate(input.branch, input.createFrom), {
			cwd: input.repoRootPath,
		});
		if (!created.ok) return created;
	}
	const added = await runner.runChecked(
		worktreeAddExistingBranch(input.worktreePath, input.branch),
		{ cwd: input.repoRootPath },
	);
	return added.ok ? ok(undefined) : added;
}

/** Restores the archive checkpoint; the caller treats a failure as a notice, not a failed restore. */
export async function restoreArchiveCheckpoint(
	runner: GitRunner,
	checkpointerPath: string,
	workspaceId: string,
	worktreePath: string,
): Promise<Result<void>> {
	const restored = await runner.run(
		checkpointerRestore(checkpointerPath, archiveCheckpointId(workspaceId)),
		{ cwd: worktreePath },
	);
	if (!restored.ok) return restored;
	if (restored.value.exitCode !== 0) {
		return err(
			appError(
				"archive_restore_failed",
				restored.value.stderr.trim() || "Couldn't restore the saved uncommitted changes.",
			),
		);
	}
	return ok(undefined);
}

/** Removes the worktree, falling back to the Trash and `worktree prune` (services-map 3.10). */
export function removeWorktree(
	runner: GitRunner,
	fs: FileSystem,
	input: { repoRootPath: string; worktreePath: string },
): Promise<Result<void>> {
	return runner.withWorktreeAndRepoLocks(input.worktreePath, input.repoRootPath, async () => {
		const removed = await runner.run(worktreeRemove(input.worktreePath), {
			cwd: input.repoRootPath,
		});
		// A command that could not start is a real failure; only a refusal by git falls through
		// to the Trash and prune path below.
		if (!removed.ok) return removed;
		if (removed.value.exitCode === 0) return ok(undefined);
		const folder = await fs.exists(input.worktreePath);
		if (!folder.ok) return folder;
		if (folder.value) {
			const trashed = await fs.trash(input.worktreePath);
			if (!trashed.ok) return trashed;
		}
		const pruned = await runner.runChecked(worktreePrune(), { cwd: input.repoRootPath });
		return pruned.ok ? ok(undefined) : pruned;
	});
}

/**
 * True when the name exists as a local branch or a remote-tracking branch (services-map 3.1).
 * Pull requests are not part of this check in the research. `show-ref --verify --quiet` exits 0
 * for a ref that exists and 1 for one that does not; a command that cannot run, or any other exit
 * code, is an error, so a name is never called free when git could not tell.
 */
export async function branchNameIsTaken(
	runner: GitRunner,
	input: { repoRootPath: string; remote: string; name: string },
): Promise<Result<boolean>> {
	for (const ref of [`refs/heads/${input.name}`, `refs/remotes/${input.remote}/${input.name}`]) {
		const command = showRefVerify(ref);
		const shown = await runner.run(command, { cwd: input.repoRootPath });
		if (!shown.ok) return shown;
		if (shown.value.exitCode === 0) return ok(true);
		if (shown.value.exitCode !== 1) return err(failedCommandError(command, shown.value));
	}
	return ok(false);
}
