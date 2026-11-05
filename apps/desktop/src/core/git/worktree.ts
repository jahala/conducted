/**
 * @feature WS-01 Worktree creation and removal
 * Owns: the git steps that create a workspace's worktree, set it up, and remove it again, plus
 * the rule that makes a branch or folder name unique.
 * Behaviour: services-map.md 3.1 (workspace create), 3.13 (worktree-level config), 3.10 (archive
 * and unarchive), 3.15 (minimal command set).
 * Must handle: a repository with no commit yet (create an empty initial commit first); fetch
 * failures (no remote, no network: fall back to the cached remote ref and tell the user; a local
 * default branch when there is no remote at all); a post-checkout hook that fails after the
 * worktree exists (downgrade to a warning); a branch name already used locally or on the remote
 * (suffix -v1, -v2, up to 1000 tries; services-map 3.1 checks these two, not pull requests);
 * `core.worktree` or `core.bare` set (do not enable worktree config); `.context/` is excluded in
 * the shared `info/exclude`, not in `.gitignore`; removal falls back to trashing the folder and
 * `worktree prune`.
 * Our design choice: the base is always a commit id, never a ref name, so the worktree starts
 * from exactly what was fetched. Removal of the folder goes through the Trash (fs.trash).
 * Test first: nextFreeName("oslo", taken: oslo, oslo-v1) returns "oslo-v2".
 */
import { appError, err, notImplemented, ok, type Result } from "@conducted/shared";
import type { FileSystem } from "../../platform/platform.ts";
import { contextDir } from "../app-paths.ts";
import {
	commitEmptyInitial,
	configGetLocal,
	configGetWorktree,
	enablePushAutoSetupRemote,
	enableWorktreeConfig,
	fetchBranchRefspec,
	revParse,
	revParseGitCommonDir,
	revParseHead,
	showRefVerify,
	worktreeAddNewBranch,
	worktreeList,
} from "./commands.ts";
import type { GitRunner } from "./runner.ts";

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
}

export interface CreatedWorktree {
	headSha: string;
	/** Set when the user should hear about something, for example an offline fetch fallback. */
	warning: string | null;
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
		const written = await input.fs.writeTextAtomic(excludePath, next);
		if (!written.ok) return written;
	}
	return ok({ warning });
}

/** Removes the worktree, falling back to the Trash and `worktree prune` (services-map 3.10). */
export function removeWorktree(
	_runner: GitRunner,
	_fs: FileSystem,
	_input: { repoRootPath: string; worktreePath: string },
): Promise<Result<void>> {
	return notImplemented("WS-05");
}

/**
 * True when the name exists as a local branch or a remote-tracking branch (services-map 3.1).
 * Pull requests are not part of this check in the research.
 */
export async function branchNameIsTaken(
	runner: GitRunner,
	input: { repoRootPath: string; remote: string; name: string },
): Promise<boolean> {
	const local = await runner.run(showRefVerify(`refs/heads/${input.name}`), {
		cwd: input.repoRootPath,
	});
	if (local.ok && local.value.exitCode === 0) return true;
	const remote = await runner.run(showRefVerify(`refs/remotes/${input.remote}/${input.name}`), {
		cwd: input.repoRootPath,
	});
	return remote.ok && remote.value.exitCode === 0;
}
