/**
 * @feature GIT-02 Git service: polling change state; GIT-06 Push and pull; GIT-13 Fetch on demand,
 * at most once a minute
 * @feature WS-02 Create from a branch, PR or issue
 * @feature GIT-05 Commit and push, done by the agent on request
 * @feature GIT-07 Resolve conflicts, done by the agent on request
 * @feature GIT-12 Branch lists, branch commits and switch branch
 * @feature GIT-17 Continue after a merge or from a detached HEAD
 * @feature GIT-15 Sparse checkout and the external diff tool
 * Owns: the repository's local branch list for the create-from picker; polling each shown
 * workspace's git state at the requested depth, the four-slot limiter, and the last error per
 * workspace. Also the write actions that move a branch across the remote:
 * push, including the first push's upstream setup; pull latest from the target, which fetches,
 * rechecks under the lock, fast-forwards or hands the work to the agent; resolve conflicts, which
 * reads the rebase or merge choice from pull.rebase and sends the instruction to the agent; and
 * the commit and push request, which sends the agent the instruction to commit the workspace and
 * push the branch.
 * Behaviour: services-map.md 3.3.1 (schedule, depths, staleness, concurrency) and 3.3.3 (a
 * cheaper poll reads only the local branch, and an answer for a branch that has since changed is
 * dropped); 3.6.1 (push, upstream, first push, no force), 3.6.4 (pull latest from target, and
 * rebase or merge by `pull.rebase`) and 3.7.6 (conflict resolution goes to the agent).
 * Must handle: every watched workspace polls every 5 s at the deepest depth any watcher asked
 * for; a result younger than 0.9 of the interval is reused; at most four refreshes at once
 * (the limiter runs foreground requests first, and every caller today is foreground); an answer
 * whose branch differs from the branch the request was made for is dropped; a failed poll keeps
 * the last snapshot and records the error; a path or commit id from a screen that could leave the
 * workspace or read as a git option is refused; discarding a file moves a file the branch added to
 * the Trash and stops when git cannot say whether the base has the file; viewed marks are saved
 * one write at a time per workspace; a push to a known upstream does not set it again; a first
 * push writes both branch keys and the remote-tracking ref; a dirty or diverged tree goes to the
 * agent, unless `pull.ff = only` forbids the agent's merge or rebase, in which case the app fetches
 * and runs `merge --ff-only`, returning git's refusal when that is impossible; the user's own
 * pull.rebase and pull.ff choose how a pull proceeds; a pull with nothing new changes nothing and
 * reports it, and a fast-forward reports that it pulled; a second push or pull while one runs joins
 * the first instead of starting
 * another; a resolve-conflicts request uses the repository prompt when it has one, and a config
 * read failure is returned instead of guessing a strategy. The app itself never force-pushes: a
 * resolve-conflicts rebase names `--force-with-lease` for the agent to run.
 * The push upstream setting (`worktree_push_auto_setup_remote`) is read only when a workspace is
 * created: workspace creation writes `push.autoSetupRemote` for the new worktree (GIT-01, WS-01).
 * Push itself does not read it.
 * Also: GIT-13 decides when the pull request's base or head is newer than the local refs and
 * fetches it at most once a minute for one repository and branch. The diff target is always a
 * remote branch: this service holds no Graphite stack data, so a local stack parent never
 * reaches the decision.
 * GIT-09: the rename reads the checked-out branch, asks the git helpers for a free name, and
 * renames under the worktree lock; a detached HEAD returns the plain "check out a branch" message.
 * The workspace folder rename, its short-lived symlink and the old-remote-branch toast are not
 * built; they need the platform file operations, a movable workspace path and a header message.
 * Our design choice: this class exposes snapshots and actions only. The Git header state machine
 * and the merge with pull request info belong to GIT-04, the other git actions belong to their
 * own features, and the restart cache belongs to DATA-07. Their placeholders stay here until those
 * features build them.
 * Changing the target branch is here (GIT-08): it stores the intended branch, moves an open pull
 * request's base, or fetches and resets a clean branch still at the old target.
 * GIT-12: lists a repository's local and remote branches and the branches its worktrees have
 * checked out, keeps that list fresh for the foreground repository every 5 s and the others every
 * 60 s, and switches a workspace to another branch by fetching it, checking it out and
 * fast-forwarding only when the branch can be fast-forwarded. The switch has its own mutex, apart
 * from the other git actions. The branch commits the diff scope lists come from the workspace poll
 * above. `dispose` stops every workspace and branch watcher, and the container's `stop()` calls
 * it, so no poll outlives the app even when a caller never unsubscribed.
 * GIT-17: Continue creates a branch in the same worktree and keeps the chats. After a merge it
 * starts from the target branch; from a detached HEAD it starts from the current commit. It writes
 * a "Branch continued" note, saves the new branch on the workspace, and sends the note to the open
 * chat. A note or chat failure is reported as "Failed to attach continue context"; the branch
 * itself stays. A failed save of the new branch on the workspace checks the old branch (or the
 * detached commit) out again and removes the new branch. The time of each continue is kept, so a
 * merged pull request read before it no longer shows for the new branch (`stateOf`).
 * GIT-15: reads and edits a workspace's sparse checkout in cone mode, and lists the top-level
 * folders to choose from. It opens one file's changes in Kaleidoscope only when that file has
 * changes, and refuses a path that leaves the workspace. Git stores the sparse settings itself,
 * so editing them is the edit; the next poll shows the new file list.
 * Test first: a workspace watched at depth full runs its poll immediately and again once the
 * interval has passed.
 */
import type { FileChange } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem, Unsubscribe } from "../../platform/platform.ts";
import type { ChangedFile, DiffScope } from "../api.ts";
import { viewedFilesFile } from "../app-paths.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { createKeyedQueue } from "../async/serial-queue.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import {
	branchDeleteForce,
	branchListLocal,
	branchShowCurrent,
	catFileExists,
	checkout,
	checkoutNewBranch,
	configGet,
	configPullFf,
	configPullRebase,
	diffQuietHead,
	diffToolKsdiff,
	diffWorkingTree,
	fetch,
	fetchBranchRefspec,
	firstPushSteps,
	forEachRefRemoteBranches,
	isAncestor,
	lsTreeTopLevelDirectories,
	mergeBase,
	mergeFastForwardOnly,
	pull as pullCommand,
	pushHeadTo,
	pushPlain,
	removeCached,
	resetHard,
	restoreFromSource,
	restoreStaged,
	revListLeftRightCount,
	revParse,
	revParseHead,
	revParseVerify,
	showCommitNameStatus,
	showCommitNumstat,
	showRefVerify,
	sparseCheckoutConfig,
	sparseCheckoutDisable,
	sparseCheckoutInitCone,
	sparseCheckoutList,
	sparseCheckoutSet,
	statusPorcelainAll,
	symbolicRefHead,
	upstreamName,
	worktreeList,
} from "../git/commands.ts";
import { type ComparisonContext, resolveComparison } from "../git/diff.ts";
import { checkpointRef, turnCheckpointId } from "../git/refs.ts";
import { freeBranchName, renameBranchInWorktree } from "../git/rename.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	type ChangesSnapshot,
	diffTargetOf,
	mergeChanges,
	parseLeftRightCount,
	parseNameStatus,
	parseNumstat,
	parseWorktreeList,
	readComparedChanges,
	readOperation,
	refreshWorkspaceChanges,
	remoteTargetRef,
	type WorktreeEntry,
} from "../git/status.ts";
import { resolveBaseCommit } from "../git/worktree.ts";
import type { GitState, PullRequestAction } from "../model.ts";
import {
	type AgentPullStrategy,
	commitAndPushInstruction,
	pullRebaseStrategy,
	pullStrategy,
	reconcileInstruction,
	resolveConflictsInstruction,
} from "./agent-instructions.ts";
import type { GitCache } from "./git-cache.ts";
import type { WorkspacePrEntry } from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";
import { isSafeRefName } from "./workspace.ts";

const DEPTH_RANK: Readonly<Record<PollDepth, number>> = { metadata: 0, uncommitted: 1, full: 2 };

/**
 * A path a screen sends, checked to stay inside the workspace folder. Absolute paths, `..`
 * segments and NUL bytes are refused, so `${cwd}/${path}` cannot reach another folder.
 */
export function workspaceRelativePath(path: string): Result<string> {
	const outside = (): Result<string> =>
		err(appError("path_outside_workspace", `"${path}" is not inside the workspace folder.`));
	if (path === "" || path.startsWith("/") || path.includes("\u0000")) return outside();
	if (path.split("/").some((part) => part === "..")) return outside();
	return ok(path);
}

/**
 * A commit id from a screen. It may not start with `-` or hold white space, so git cannot read it
 * as an option such as `--output=x`.
 */
export function checkedCommitId(sha: string): Result<string> {
	const clean = sha !== "" && !sha.startsWith("-") && !/\s/.test(sha) && !sha.includes("\u0000");
	return clean ? ok(sha) : err(appError("git_bad_revision", `"${sha}" is not a commit id.`));
}

/** The lines `git sparse-checkout list` and `git ls-tree` print, without blanks. */
function parseSparseCheckoutDirectories(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * The directories a user chose for a workspace's sparse checkout. Each must stay inside the
 * workspace, and repeats collapse to the first one.
 */
function checkedSparseCheckoutDirectories(directories: readonly string[]): Result<string[]> {
	const clean: string[] = [];
	for (const raw of directories) {
		const path = raw.trim();
		if (path === "") continue;
		const checked = workspaceRelativePath(path);
		if (!checked.ok) return checked;
		if (!clean.includes(checked.value)) clean.push(checked.value);
	}
	return ok(clean);
}

/** What a workspace's sparse checkout settings hold (services-map 3.11, 5A.5.3). */
interface SparseCheckoutSettings {
	enabled: boolean;
	/** The directories git includes, empty when sparse checkout is off. */
	directories: string[];
	/** The top-level folders of the checked-out commit, the choices to offer the user. */
	topLevelDirectories: string[];
}

/** What `git cat-file -e` prints when the path is not in the base commit. */
const MISSING_IN_BASE = /(path .* does not exist in|exists on disk, but not in)/i;

export interface WorkspaceGitEntry {
	snapshot: ChangesSnapshot | null;
	error: { code: string; message: string } | null;
	refreshedAt: number | null;
}

/** The branch names of one repository, as the branch picker needs them. */
export interface RepositoryBranches {
	local: string[];
	remote: string[];
	/** Branches another worktree of the same repository has checked out. */
	checkedOut: string[];
}

export interface BranchesEntry {
	branches: RepositoryBranches | null;
	error: { code: string; message: string } | null;
	refreshedAt: number | null;
}

export interface GitServiceState {
	byWorkspace: Readonly<Record<string, WorkspaceGitEntry>>;
	/** Branch lists keyed by the repository's main worktree folder. */
	branchesByRepo: Readonly<Record<string, BranchesEntry>>;
	/**
	 * When each workspace last continued on a new branch (GIT-17). A merged pull request read
	 * before that time belongs to the branch the workspace left, so `stateOf` no longer shows it.
	 */
	continuedAt: Readonly<Record<string, number>>;
}

export type PollDepth = "metadata" | "uncommitted" | "full";
/** Which repository the user is looking at, which sets how often its branches are read. */
export type BranchWatchRole = "foreground" | "background";

/** How often a workspace on screen is polled (services-map 3.3.1). */
export const GIT_POLL_INTERVAL_MS = 5_000;
/** A result younger than this share of the interval is reused instead of polled again. */
export const POLL_FRESH_RATIO = 0.9;
/** Most changes refreshes that run at once (services-map 3.3.1). */
export const MAX_CONCURRENT_REFRESHES = 4;
/** How often the foreground repository's branch list is read (services-map 3.3.1, 3.3.3). */
export const BRANCH_POLL_INTERVAL_MS = 5_000;
/** How often another tracked repository's branch list is read (services-map 3.3.1, 3.3.3). */
export const BRANCH_BACKGROUND_POLL_INTERVAL_MS = 60_000;

/** Splits a branch list on new lines, dropping blank lines and any full ref prefix. */
function branchNamesFrom(text: string, prefix: string): string[] {
	const names: string[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line.length === 0) continue;
		const name = line.startsWith(prefix) ? line.slice(prefix.length) : line;
		if (name.length > 0 && !names.includes(name)) names.push(name);
	}
	return names;
}

/** The local branch names from `git branch --format=%(refname:short)` (services-map 3.6.6). */
export function parseLocalBranches(text: string): string[] {
	return branchNamesFrom(text, "refs/heads/");
}

/**
 * The branch names on one remote from `git for-each-ref` (services-map 3.6.6). The remote's `HEAD`
 * symbolic ref is not a branch and is dropped.
 */
export function parseRemoteBranches(text: string, remote: string): string[] {
	const prefix = remote.length > 0 ? `${remote}/` : "";
	const names: string[] = [];
	for (const name of branchNamesFrom(text, `refs/remotes/${remote}/`)) {
		const bare = prefix.length > 0 && name.startsWith(prefix) ? name.slice(prefix.length) : name;
		if (bare.length === 0 || bare === "HEAD") continue;
		if (!names.includes(bare)) names.push(bare);
	}
	return names;
}

/** The branches checked out by the repository's worktrees (services-map 3.3.3). */
export function parseCheckedOutBranches(text: string): string[] {
	return branchNamesFrom(
		parseWorktreeList(text)
			.map((entry: WorktreeEntry) => entry.branch ?? "")
			.join("\n"),
		"",
	);
}

/** Shown when a pull finds nothing to bring in. */
export const PULL_UP_TO_DATE_MESSAGE = "Pulled latest changes. You're up to date!";
/** Shown after a pull brings in new commits (services-map 3.6.4 step 4). */
export const PULLED_LATEST_MESSAGE = "Pulled latest changes.";

/** Shown when the "Branch continued" note or its chat message cannot be attached. */
export const CONTINUE_NOTE_FAILED_MESSAGE = "Failed to attach continue context";

/** The note a continued workspace leaves for its agent (inventory:toast row 578). */
const CONTINUE_NOTE_FILE_NAME = "Branch continued.md";
const CONTINUE_NOTE_FOLDER = ".context";

function continueNoteText(input: {
	previousBranch: string;
	newBranch: string;
	startRef: string;
}): string {
	const from =
		input.previousBranch.trim() === "" ? "a detached HEAD" : `branch ${input.previousBranch}`;
	return `# Branch continued\n\nThe workspace moved from ${from} to the new branch ${input.newBranch}, started from ${input.startRef}.\nContinue the work on ${input.newBranch}.\n\nThis note is saved as ${CONTINUE_NOTE_FOLDER}/${CONTINUE_NOTE_FILE_NAME}.\n`;
}

/** What a pull did: nothing new, a fast-forward, git's plain pull, or an agent hand-off. */
export type PullOutcome = "up_to_date" | "fast_forwarded" | "plain" | "handed_to_agent";

/** The branch part of `origin/main` or `refs/remotes/origin/main`, for an agent instruction. */
export function targetBranchName(targetBranch: string, remote: string): string {
	const trimmed = targetBranch.trim();
	if (remote.length > 0) {
		const remotePrefix = `${remote}/`;
		if (trimmed.startsWith(remotePrefix)) return trimmed.slice(remotePrefix.length);
		const refPrefix = `refs/remotes/${remote}/`;
		if (trimmed.startsWith(refPrefix)) return trimmed.slice(refPrefix.length);
	}
	return trimmed.startsWith("refs/heads/") ? trimmed.slice("refs/heads/".length) : trimmed;
}

/** The remote branch a known upstream names, or null when it is not on `remote`. */
export function upstreamBranchOn(upstream: string, remote: string): string | null {
	const name = upstream.trim();
	const prefix = `${remote}/`;
	if (!name.startsWith(prefix)) return null;
	const branch = name.slice(prefix.length);
	return branch.length > 0 ? branch : null;
}

/**
 * The remote branch of a first push. A configured `branch.<name>.merge` on the same remote wins,
 * because the user already chose that name; otherwise the local branch name is used.
 */
export function firstPushRemoteBranch(input: {
	branch: string;
	remote: string;
	configuredRemote: string;
	configuredMerge: string;
}): string {
	const merge = input.configuredMerge.trim();
	const prefix = "refs/heads/";
	if (input.configuredRemote.trim() === input.remote && merge.startsWith(prefix)) {
		const name = merge.slice(prefix.length);
		if (name.length > 0) return name;
	}
	return input.branch;
}

/** Drops a command's output when the caller only needs to know whether it worked. */
const discardValue = <T>(result: Result<T>): Result<void> => (result.ok ? ok(undefined) : result);

interface LimiterEntry {
	readonly workspaceId: string;
	readonly work: () => Promise<unknown>;
	readonly resolve: (value: unknown) => void;
	readonly reject: (reason: unknown) => void;
}

export interface RefreshLimiter {
	/** Runs `work` in a slot. A foreground request runs before queued background ones. */
	run<T>(workspaceId: string, foreground: boolean, work: () => Promise<T>): Promise<T>;
}

/**
 * The four-slot queue of changes refreshes. Work already running is never preempted; the
 * foreground queue is drained first whenever a slot opens.
 */
export function createRefreshLimiter(
	maxConcurrent: number = MAX_CONCURRENT_REFRESHES,
): RefreshLimiter {
	let active = 0;
	const foreground: LimiterEntry[] = [];
	const background: LimiterEntry[] = [];

	const pump = (): void => {
		while (active < maxConcurrent) {
			const entry = foreground.shift() ?? background.shift();
			if (entry === undefined) return;
			active += 1;
			void Promise.resolve()
				.then(entry.work)
				.then(entry.resolve, entry.reject)
				.finally(() => {
					active -= 1;
					pump();
				});
		}
	};

	return {
		run<T>(workspaceId: string, foregroundRequest: boolean, work: () => Promise<T>): Promise<T> {
			return new Promise<T>((resolve, reject) => {
				const entry: LimiterEntry = {
					workspaceId,
					work: work as () => Promise<unknown>,
					resolve: resolve as (value: unknown) => void,
					reject,
				};
				(foregroundRequest ? foreground : background).push(entry);
				pump();
			});
		},
	};
}

interface Watcher {
	count: number;
	depth: PollDepth;
	stopped: boolean;
	timer: ReturnType<typeof setTimeout> | null;
}

interface BranchWatcher {
	count: number;
	role: BranchWatchRole;
	stopped: boolean;
	timer: ReturnType<typeof setTimeout> | null;
}

/** How often a repository in this role is read (services-map 3.3.1). */
const branchInterval = (role: BranchWatchRole): number =>
	role === "foreground" ? BRANCH_POLL_INTERVAL_MS : BRANCH_BACKGROUND_POLL_INTERVAL_MS;

export interface WorkspaceGitContext {
	workspaceId: WorkspaceId;
	workspacePath: string;
	repoRootPath: string;
	remote: string;
	targetBranch: string;
	branch: string;
}

/** Least time between two fetches of one repository and branch (GIT-13, services-map.md 3.0.2). */
export const FETCH_MIN_GAP_MS = 60_000;

/** What the agent-facing diff says while a merge or rebase is open (services-map.md 3.4.6). */
export const AGENT_DIFF_BUSY_MESSAGE = "Cannot fetch diff: merge or rebase in progress.";

/** The commits GitHub reports for a pull request, and what the local refs hold (GIT-13). */
export interface FetchStaleness {
	/** Name of the remote, for example "origin". */
	remote: string;
	/** The branch the workspace is diffed against, without a remote prefix, for example "main". */
	targetBranch: string;
	/** The workspace's branch name, for example "feat". */
	branch: string;
	/** The commit the PR's base branch is at on GitHub. */
	prBaseOid: string;
	/** The commit the PR's head branch is at on GitHub. */
	prHeadOid: string;
	/** `refs/remotes/<remote>/<target>` in this repository. Null when the ref does not exist. */
	localBaseOid: string | null;
	/** The branch's upstream, `refs/remotes/<remote>/<branch>`. Null when it has none. */
	upstreamOid: string | null;
	/** The diff target is a branch of the same stack, so its remote ref says nothing. */
	baseIsLocalStackParent: boolean;
}

export type FetchDecision =
	| { fetch: false; reason: "in_sync" | "too_soon" | "stack_parent" }
	| { fetch: true; refspecs: readonly string[] };

/** The remote-tracking branch a refspec writes, so a fetch also refreshes the local ref. */
function fetchRefspec(remote: string, branch: string): string {
	return `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`;
}

/**
 * Whether to fetch now. `lastFetchedAt` is the time of the last fetch for the same repository and
 * branch, or null when there was none. Pure: the caller reads the refs and the clock.
 *
 * The base is fetched only when the diff target is a remote branch: a local stack parent has no
 * remote ref to compare with. A stale head is fetched even when the base is a stack parent.
 */
export function decideFetch(
	staleness: FetchStaleness,
	lastFetchedAt: number | null,
	now: number,
): FetchDecision {
	const baseDiffers =
		staleness.targetBranch.length > 0 &&
		(staleness.localBaseOid === null || staleness.localBaseOid !== staleness.prBaseOid);
	const headDiffers =
		staleness.branch.length > 0 &&
		(staleness.upstreamOid === null || staleness.upstreamOid !== staleness.prHeadOid);
	const fetchBase = baseDiffers && !staleness.baseIsLocalStackParent;

	if (!fetchBase && !headDiffers) {
		return {
			fetch: false,
			reason: baseDiffers && staleness.baseIsLocalStackParent ? "stack_parent" : "in_sync",
		};
	}
	if (lastFetchedAt !== null && now - lastFetchedAt < FETCH_MIN_GAP_MS) {
		return { fetch: false, reason: "too_soon" };
	}

	const refspecs: string[] = [];
	if (fetchBase) refspecs.push(fetchRefspec(staleness.remote, staleness.targetBranch));
	if (headDiffers) {
		const head = fetchRefspec(staleness.remote, staleness.branch);
		if (!refspecs.includes(head)) refspecs.push(head);
	}
	return { fetch: true, refspecs };
}

export interface GitServiceDeps {
	git: GitRunner;
	/** The last snapshot of each workspace, shown before the first poll answers (DATA-07). */
	cache: GitCache;
	/** Looks up folders and branch names for a workspace. Fails for unknown ids. */
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
	agent: AgentMessenger;
	/**
	 * The repository's Resolve conflicts prompt, or null when it has none. The container always
	 * supplies it. Tests that never resolve conflicts may leave it out; `resolveConflicts` returns
	 * an error instead of guessing when it is absent.
	 */
	promptFor?: (workspaceId: WorkspaceId) => Promise<Result<string | null>>;
	/** Saves the branch now checked out in the workspace row and its store (GIT-09, GIT-12). */
	renameWorkspaceBranch: (workspaceId: WorkspaceId, branch: string) => Promise<Result<void>>;
	now: () => number;
	/** Moves a discarded new file to the Trash, and stores the viewed marks. */
	fs: Pick<FileSystem, "trash" | "readText" | "writeTextAtomic" | "mkdirp" | "stat" | "paths">;
	/** Stores the intended target branch and updates the loaded workspace row (GIT-08). */
	setIntendedTargetBranch: (workspaceId: WorkspaceId, branch: string) => Promise<Result<void>>;
	/** Moves an open pull request's base; false when there is no open pull request (GIT-08). */
	moveOpenPullRequestBase: (workspaceId: WorkspaceId, branch: string) => Promise<Result<boolean>>;
}

/**
 * A branch name that can be fetched and used as a pull request base: refs and a leading remote
 * name are removed. The target as the user entered it is what the workspace stores.
 */
export function branchNameWithoutRemote(branch: string, remote: string): string {
	const heads = /^refs\/heads\/(.+)$/.exec(branch);
	if (heads?.[1] !== undefined) return heads[1];
	const remotes = /^refs\/remotes\/[^/]+\/(.+)$/.exec(branch);
	if (remotes?.[1] !== undefined) return remotes[1];
	if (remote.length > 0 && branch.startsWith(`${remote}/`)) return branch.slice(remote.length + 1);
	return branch;
}

/**
 * A target branch entered by the user or an agent. Trims it, refuses a name git could read as an
 * option, and returns the bare branch name: no refs prefix and no leading remote name. The bare
 * name is the one stored form, used for the stored target, the fetched ref, the reset and the
 * pull request base (services-map 3.11).
 */
export function parseTargetBranch(remote: string, input: string): Result<string> {
	const entered = input.trim();
	if (!isSafeRefName(entered)) {
		return err(
			appError("workspace_branch_invalid", `"${entered}" can't be used as a Git branch name.`),
		);
	}
	return ok(branchNameWithoutRemote(entered, remote));
}

/** One file's viewed mark, together with the version of the file it was made on. */
interface ViewedMark {
	viewed: boolean;
	fingerprint: string;
}

interface ViewedFile {
	version: 1;
	marks: Record<string, ViewedMark>;
}

export class GitService {
	readonly store: StoreApi<GitServiceState>;
	readonly #deps: GitServiceDeps;
	/** When each repository and branch was last fetched, keyed by root path and branch. */
	readonly #lastFetchAt = new Map<string, number>();
	readonly #watchers = new Map<string, Watcher>();
	readonly #branchWatchers = new Map<string, BranchWatcher>();
	readonly #latest = createLatestWins<string>();
	readonly #branchesLatest = createLatestWins<string>();
	readonly #limiter = createRefreshLimiter();
	/** Switch-branch requests for one workspace run one after another, apart from other actions. */
	readonly #switchQueue = createKeyedQueue();
	/** Viewed marks per workspace and path. Loaded from the file on first use. */
	readonly #viewed = new Map<string, ViewedMark>();
	readonly #viewedLoaded = new Set<string>();
	/** Loads and saves of one workspace's viewed marks run one after another. */
	readonly #viewedQueue = createKeyedQueue();
	/** A second push or pull while one runs joins the first (services-map 3.0.3). */
	readonly #flights = createSingleFlight<string>();

	constructor(deps: GitServiceDeps) {
		this.#deps = deps;
		this.store = createStore<GitServiceState>(() => ({
			byWorkspace: {},
			branchesByRepo: {},
			continuedAt: {},
		}));
	}

	/** Polls a workspace until the returned function is called. Several callers share one timer. */
	watch(workspaceId: WorkspaceId, depth: PollDepth): Unsubscribe {
		const key = String(workspaceId);
		const existing = this.#watchers.get(key);
		if (existing !== undefined) {
			existing.count += 1;
			// The deepest request wins, so a shallow second watcher cannot starve the first.
			if (DEPTH_RANK[depth] > DEPTH_RANK[existing.depth]) existing.depth = depth;
			return () => this.#unwatch(key);
		}

		const watcher: Watcher = { count: 1, depth, stopped: false, timer: null };
		this.#watchers.set(key, watcher);
		const tick = async (): Promise<void> => {
			if (watcher.stopped) return;
			await this.#limiter.run(key, true, () =>
				this.#refreshIfStale(workspaceId, watcher.depth, GIT_POLL_INTERVAL_MS),
			);
			if (watcher.stopped) return;
			watcher.timer = setTimeout(() => {
				void tick();
			}, GIT_POLL_INTERVAL_MS);
		};
		void tick();
		return () => this.#unwatch(key);
	}

	refresh(workspaceId: WorkspaceId, depth: PollDepth): Promise<Result<void>> {
		return this.#limiter.run(String(workspaceId), true, () => this.#refreshNow(workspaceId, depth));
	}

	#unwatch(key: string): void {
		const watcher = this.#watchers.get(key);
		if (watcher === undefined) return;
		watcher.count -= 1;
		if (watcher.count > 0) return;
		watcher.stopped = true;
		if (watcher.timer !== null) clearTimeout(watcher.timer);
		this.#watchers.delete(key);
		this.#latest.invalidate(key);
	}

	/**
	 * Polls one repository's branches until the returned function is called. Several callers share
	 * one timer, and a foreground caller raises the rate of a background one (services-map 3.3.1).
	 */
	watchBranches(repoRootPath: string, remote: string, role: BranchWatchRole): Unsubscribe {
		const key = repoRootPath;
		const existing = this.#branchWatchers.get(key);
		if (existing !== undefined) {
			existing.count += 1;
			if (role === "foreground") existing.role = "foreground";
			return () => this.#unwatchBranches(key);
		}

		const watcher: BranchWatcher = { count: 1, role, stopped: false, timer: null };
		this.#branchWatchers.set(key, watcher);
		const tick = async (): Promise<void> => {
			if (watcher.stopped) return;
			await this.#limiter.run(`branches:${key}`, watcher.role === "foreground", () =>
				this.#refreshBranchesIfStale(repoRootPath, remote, branchInterval(watcher.role)),
			);
			if (watcher.stopped) return;
			watcher.timer = setTimeout(() => {
				void tick();
			}, branchInterval(watcher.role));
		};
		void tick();
		return () => this.#unwatchBranches(key);
	}

	#unwatchBranches(key: string): void {
		const watcher = this.#branchWatchers.get(key);
		if (watcher === undefined) return;
		watcher.count -= 1;
		if (watcher.count > 0) return;
		watcher.stopped = true;
		if (watcher.timer !== null) clearTimeout(watcher.timer);
		this.#branchWatchers.delete(key);
		this.#branchesLatest.invalidate(key);
	}

	/**
	 * Stops every workspace and branch watcher and drops their timers. The container's `stop()`
	 * calls it. An unsubscribe that arrives later finds nothing and does nothing.
	 */
	dispose(): void {
		for (const [key, watcher] of this.#watchers) {
			watcher.stopped = true;
			if (watcher.timer !== null) clearTimeout(watcher.timer);
			this.#latest.invalidate(key);
		}
		this.#watchers.clear();
		for (const [key, watcher] of this.#branchWatchers) {
			watcher.stopped = true;
			if (watcher.timer !== null) clearTimeout(watcher.timer);
			this.#branchesLatest.invalidate(key);
		}
		this.#branchWatchers.clear();
	}

	/** The last branch list of a repository, or null until one was read. */
	branchesOf(repoRootPath: string): BranchesEntry | null {
		return this.store.getState().branchesByRepo[repoRootPath] ?? null;
	}

	async #refreshBranchesIfStale(
		repoRootPath: string,
		remote: string,
		intervalMs: number,
	): Promise<Result<void>> {
		const entry = this.branchesOf(repoRootPath);
		if (
			entry?.branches != null &&
			entry.refreshedAt !== null &&
			this.#deps.now() - entry.refreshedAt < intervalMs * POLL_FRESH_RATIO
		) {
			return ok(undefined);
		}
		return this.#refreshBranchesNow(repoRootPath, remote, false);
	}

	/**
	 * The repository's local branches, newest commit first, for the create-from picker. With a
	 * remote, it also refreshes and returns the branch list the branch picker shows.
	 */
	async listBranches(repoRootPath: string, remote: string): Promise<Result<RepositoryBranches>>;
	async listBranches(repoRootPath: string): Promise<Result<string[]>>;
	async listBranches(
		repoRootPath: string,
		remote?: string,
	): Promise<Result<string[] | RepositoryBranches>> {
		if (remote === undefined) {
			const listed = await this.#deps.git.stdout(branchListLocal(), { cwd: repoRootPath });
			if (!listed.ok) return listed;
			return ok(parseLocalBranches(listed.value));
		}
		const refreshed = await this.#refreshBranchesNow(repoRootPath, remote, true);
		if (!refreshed.ok) return refreshed;
		const entry = this.branchesOf(repoRootPath);
		if (entry?.branches == null) {
			return err(appError("git_failed", "The branch list could not be read."));
		}
		return ok(entry.branches);
	}

	/** Reads a repository's branches without the user asking first, for the watcher. */
	async refreshBranches(repoRootPath: string, remote: string): Promise<Result<void>> {
		return this.#refreshBranchesNow(repoRootPath, remote, false);
	}

	async #refreshBranchesNow(
		repoRootPath: string,
		remote: string,
		fetchRemote: boolean,
	): Promise<Result<void>> {
		const key = repoRootPath;
		const ticket = this.#branchesLatest.begin(key);
		if (fetchRemote && remote.length > 0) {
			const fetched = await this.#deps.git.runChecked(fetch(remote), { cwd: repoRootPath });
			if (!fetched.ok) {
				if (this.#branchesLatest.isLatest(ticket)) {
					this.#recordBranchFailure(key, fetched.error);
				}
				this.#branchesLatest.settle(ticket);
				return err(fetched.error);
			}
		}

		const [local, remoteBranches, worktrees] = await Promise.all([
			this.#deps.git.stdout(branchListLocal(), { cwd: repoRootPath }),
			this.#deps.git.stdout(forEachRefRemoteBranches(remote), { cwd: repoRootPath }),
			this.#deps.git.stdout(worktreeList(), { cwd: repoRootPath }),
		]);
		const fail = (error: AppError): Result<void> => {
			if (this.#branchesLatest.isLatest(ticket)) this.#recordBranchFailure(key, error);
			this.#branchesLatest.settle(ticket);
			return err(error);
		};
		if (!local.ok) return fail(local.error);
		if (!remoteBranches.ok) return fail(remoteBranches.error);
		if (!worktrees.ok) return fail(worktrees.error);

		if (!this.#branchesLatest.isLatest(ticket)) {
			this.#branchesLatest.settle(ticket);
			return ok(undefined);
		}
		this.#branchesLatest.settle(ticket);

		const branches: RepositoryBranches = {
			local: parseLocalBranches(local.value),
			remote: parseRemoteBranches(remoteBranches.value, remote),
			checkedOut: parseCheckedOutBranches(worktrees.value),
		};
		this.store.setState((state) => ({
			...state,
			branchesByRepo: {
				...state.branchesByRepo,
				[key]: { branches, error: null, refreshedAt: this.#deps.now() },
			},
		}));
		return ok(undefined);
	}

	#recordBranchFailure(key: string, error: AppError): void {
		const previous = this.store.getState().branchesByRepo[key];
		this.store.setState((state) => ({
			...state,
			branchesByRepo: {
				...state.branchesByRepo,
				[key]: {
					branches: previous?.branches ?? null,
					error: { code: error.code, message: error.message },
					refreshedAt: this.#deps.now(),
				},
			},
		}));
	}

	async #refreshIfStale(
		workspaceId: WorkspaceId,
		depth: PollDepth,
		intervalMs: number,
	): Promise<Result<void>> {
		const entry = this.store.getState().byWorkspace[String(workspaceId)];
		if (
			entry?.snapshot != null &&
			entry.refreshedAt !== null &&
			this.#deps.now() - entry.refreshedAt < intervalMs * POLL_FRESH_RATIO
		) {
			return ok(undefined);
		}
		return this.#refreshNow(workspaceId, depth);
	}

	async #refreshNow(workspaceId: WorkspaceId, depth: PollDepth): Promise<Result<void>> {
		const key = String(workspaceId);
		const ticket = this.#latest.begin(key);
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) {
			const latest = this.#latest.isLatest(ticket);
			this.#latest.settle(ticket);
			if (!latest) return ok(undefined);
			this.#recordFailure(workspaceId, context.error);
			return err(context.error);
		}

		const found = context.value;
		const target = diffTargetOf({
			graphiteParentBranch: null,
			pullRequestBaseBranch: null,
			intendedTargetBranch: found.targetBranch,
			remote: found.remote,
		});
		const result = await refreshWorkspaceChanges(this.#deps.git, {
			workspaceId,
			workspacePath: found.workspacePath,
			targetRef: target.ref,
			remote: found.remote,
			depth,
		});

		if (!this.#latest.isLatest(ticket)) {
			this.#latest.settle(ticket);
			return ok(undefined);
		}
		this.#latest.settle(ticket);

		if (!result.ok) {
			this.#recordFailure(workspaceId, result.error);
			return err(result.error);
		}

		// An answer for a branch that has since changed must not land (services-map 3.3.3).
		const expectedBranch = found.branch.length > 0 ? found.branch : null;
		if (result.value.branch !== expectedBranch) return ok(undefined);

		const previous = this.store.getState().byWorkspace[key]?.snapshot ?? null;
		// A metadata poll reads only the branch, so every other part stays as it was and the depth
		// marks the counts as unknown. An uncommitted poll keeps the last full poll's changed-file
		// count, which it did not read again.
		const snapshot: ChangesSnapshot =
			depth === "metadata" && previous !== null
				? {
						...previous,
						depth: "metadata",
						branch: result.value.branch,
						uncommittedFiles: null,
						changedFiles: null,
					}
				: depth === "uncommitted" &&
						previous !== null &&
						previous.changedFiles !== null &&
						result.value.changedFiles === null
					? { ...result.value, changedFiles: previous.changedFiles }
					: result.value;
		this.store.setState((state) => ({
			byWorkspace: {
				...state.byWorkspace,
				[key]: { snapshot, error: null, refreshedAt: this.#deps.now() },
			},
		}));
		return ok(undefined);
	}

	#recordFailure(workspaceId: WorkspaceId, error: AppError): void {
		const key = String(workspaceId);
		const previous = this.store.getState().byWorkspace[key];
		this.store.setState((state) => ({
			byWorkspace: {
				...state.byWorkspace,
				[key]: {
					snapshot: previous?.snapshot ?? null,
					error: { code: error.code, message: error.message },
					refreshedAt: this.#deps.now(),
				},
			},
		}));
	}

	/**
	 * Backs `useGitState`: the polled snapshot merged with the PR entry the caller read from the
	 * GitHub service. Returns null until a poll has stored both counts: a metadata poll knows
	 * nothing, and an uncommitted poll has no branch comparison. `pendingAction` is the pull
	 * request action running in the GitHub service, if any.
	 */
	stateOf(
		workspaceId: WorkspaceId,
		prEntry?: WorkspacePrEntry,
		pendingAction: PullRequestAction | null = null,
	): GitState | null {
		const state = this.store.getState();
		const snapshot = state.byWorkspace[String(workspaceId)]?.snapshot ?? null;
		if (snapshot === null) return null;
		if (
			DEPTH_RANK[snapshot.depth] < DEPTH_RANK.uncommitted ||
			snapshot.uncommittedFiles === null ||
			snapshot.changedFiles === null
		) {
			return null;
		}
		// A merged pull request read no later than the last Continue belongs to the branch the
		// workspace left. The new branch has no pull request until GitHub says otherwise.
		const continuedAt = state.continuedAt[String(workspaceId)];
		const leftBehind =
			continuedAt !== undefined &&
			prEntry?.pullRequest?.state === "merged" &&
			(prEntry.fetchedAt ?? 0) <= continuedAt;
		return {
			branch: snapshot.branch ?? "",
			uncommittedFiles: snapshot.uncommittedFiles,
			changedFiles: snapshot.changedFiles,
			linesAdded: snapshot.files.reduce((total, file) => total + file.linesAdded, 0),
			linesRemoved: snapshot.files.reduce((total, file) => total + file.linesRemoved, 0),
			hasConflicts: snapshot.conflictedPaths.length > 0,
			operation: snapshot.operation,
			sync: snapshot.sync,
			pullRequest: leftBehind ? null : (prEntry?.pullRequest ?? null),
			pullRequestUnavailable:
				prEntry === undefined
					? "loading"
					: leftBehind || prEntry.unavailable === "no_pr"
						? "none"
						: prEntry.unavailable,
			untrackedFilesTruncated: snapshot.untrackedTruncated,
			pendingPullRequestAction: pendingAction,
		};
	}

	/** Backs `useChangedFiles`. */
	async changedFiles(workspaceId: WorkspaceId, scope: DiffScope): Promise<Result<ChangedFile[]>> {
		if (scope.kind === "commit") return this.#commitFiles(workspaceId, scope.sha);

		const resolved = await this.resolveScope(workspaceId, scope);
		if (!resolved.ok) return resolved;
		const { cwd, from, to } = resolved.value;
		const compared = await readComparedChanges(this.#deps.git, cwd, from, to);
		if (!compared.ok) return compared;

		const conflicted = new Set(compared.value.conflictedPaths);
		const files = await this.#applyViewed(workspaceId, cwd, compared.value.files);
		return ok(
			files.map((change) => ({
				...change,
				conflicted: conflicted.has(change.path),
			})),
		);
	}

	/** A commit's files come from `show`, which also works for a root commit. */
	async #commitFiles(workspaceId: WorkspaceId, rawSha: string): Promise<Result<ChangedFile[]>> {
		const checked = checkedCommitId(rawSha);
		if (!checked.ok) return checked;
		const sha = checked.value;
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const cwd = found.value.workspacePath;
		const [nameStatusText, numstatText] = await Promise.all([
			this.#deps.git.stdout(showCommitNameStatus(sha), { cwd }),
			this.#deps.git.stdout(showCommitNumstat(sha), { cwd }),
		]);
		if (!nameStatusText.ok) return nameStatusText;
		if (!numstatText.ok) return numstatText;
		const files = await this.#applyViewed(
			workspaceId,
			cwd,
			mergeChanges(parseNameStatus(nameStatusText.value), parseNumstat(numstatText.value)),
		);
		return ok(files.map((change) => ({ ...change, conflicted: false })));
	}

	/** Resolves a diff scope to the folder and the two refs to compare (see git/diff.ts). */
	async resolveScope(
		workspaceId: WorkspaceId,
		scope: DiffScope,
	): Promise<Result<{ cwd: string; from: string; to: string | null }>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;
		const cwd = context.workspacePath;
		const branch = context.branch.length > 0 ? context.branch : "HEAD";
		const targetRef =
			context.targetBranch.length > 0 ? remoteTargetRef(context.targetBranch, context.remote) : "";

		let mergeBaseWithTarget: string | null = null;
		let mergeBaseWithScopeTarget: string | null = null;
		if (scope.kind === "branch") {
			const base = await this.#mergeBase(cwd, targetRef, branch);
			if (!base.ok) return base;
			mergeBaseWithTarget = base.value;
		} else if (scope.kind === "target") {
			const base = await this.#mergeBase(
				cwd,
				remoteTargetRef(scope.branch, context.remote),
				branch,
			);
			if (!base.ok) return base;
			mergeBaseWithScopeTarget = base.value;
		}

		let turnCheckpoints: { startExists: boolean; endExists: boolean } = {
			startExists: false,
			endExists: false,
		};
		if (scope.kind === "turn") {
			const start = await this.#refExists(
				cwd,
				checkpointRef(turnCheckpointId(scope.sessionId, scope.turnId, "start")),
			);
			if (!start.ok) return start;
			const end = await this.#refExists(
				cwd,
				checkpointRef(turnCheckpointId(scope.sessionId, scope.turnId, "end")),
			);
			if (!end.ok) return end;
			turnCheckpoints = { startExists: start.value, endExists: end.value };
		}

		let commitParentExists: boolean | undefined;
		if (scope.kind === "commit") {
			const checked = checkedCommitId(scope.sha);
			if (!checked.ok) return checked;
			const parent = await this.#revisionExists(cwd, `${scope.sha}^`);
			if (!parent.ok) return parent;
			commitParentExists = parent.value;
		}

		const comparisonContext: ComparisonContext = {
			mergeBaseWithTarget,
			mergeBaseWithScopeTarget,
			turnCheckpoints,
			commitParentExists,
		};
		const comparison = resolveComparison(scope, comparisonContext);
		if (!comparison.ok) return comparison;
		return ok({ cwd, from: comparison.value.from, to: comparison.value.to });
	}

	/**
	 * The common ancestor of two refs. Exit code 1 is git's normal "no common ancestor"; every
	 * other failure is returned so a broken repository does not look like a missing branch point.
	 */
	async #mergeBase(cwd: string, targetRef: string, branch: string): Promise<Result<string | null>> {
		if (targetRef.length === 0) return ok(null);
		const result = await this.#deps.git.run(mergeBase(targetRef, branch), { cwd });
		if (!result.ok) return result;
		if (result.value.exitCode === 0) return ok(result.value.stdout.trim() || null);
		if (result.value.exitCode === 1) return ok(null);
		return err(
			appError(
				"git_failed",
				result.value.stderr.trim() || `git merge-base exited with code ${result.value.exitCode}`,
			),
		);
	}

	async #refExists(cwd: string, ref: string): Promise<Result<boolean>> {
		const result = await this.#deps.git.run(showRefVerify(ref), { cwd });
		if (!result.ok) return result;
		if (result.value.exitCode === 0) return ok(true);
		if (result.value.exitCode === 1) return ok(false);
		return err(
			appError(
				"git_failed",
				result.value.stderr.trim() || `git show-ref exited with code ${result.value.exitCode}`,
			),
		);
	}

	/** Whether a revision such as `HEAD^` names an object. Used to spot a root commit. */
	async #revisionExists(cwd: string, revision: string): Promise<Result<boolean>> {
		const result = await this.#deps.git.run(revParseVerify(revision), { cwd });
		if (!result.ok) return result;
		return ok(result.value.exitCode === 0);
	}

	/**
	 * Backs the `getWorkspaceDiff` agent tool: the diff against the merge base, or its stat. A merge
	 * or rebase in progress is a `git_busy` error, because the diff would be half-written.
	 */
	async agentDiff(
		workspaceId: WorkspaceId,
		file: string | undefined,
		statOnly: boolean,
	): Promise<Result<string>> {
		const resolved = await this.resolveScope(workspaceId, { kind: "branch" });
		if (!resolved.ok) return resolved;
		const { cwd, from } = resolved.value;
		const operation = await readOperation(this.#deps.git, cwd);
		if (!operation.ok) return operation;
		if (operation.value !== "none") return err(appError("git_busy", AGENT_DIFF_BUSY_MESSAGE));
		return this.#deps.git.stdout(diffWorkingTree(from, statOnly, file), { cwd });
	}

	/**
	 * Fetches the PR's base and head branches when the local remote-tracking refs are behind them,
	 * at most once per `FETCH_MIN_GAP_MS` for one repository and branch, then refreshes the
	 * workspace. `fetched` is false when `decideFetch` said not to.
	 */
	async fetchIfStale(
		workspaceId: WorkspaceId,
		pullRequestOids: Pick<FetchStaleness, "prBaseOid" | "prHeadOid">,
	): Promise<Result<{ fetched: boolean }>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;

		const baseRef =
			context.targetBranch.length > 0 ? remoteTargetRef(context.targetBranch, context.remote) : "";
		const upstreamRef =
			context.branch.length > 0 ? remoteTargetRef(context.branch, context.remote) : "";
		const [localBase, upstream] = await Promise.all([
			this.#remoteOid(context.workspacePath, baseRef),
			this.#remoteOid(context.workspacePath, upstreamRef),
		]);
		if (!localBase.ok) return localBase;
		if (!upstream.ok) return upstream;

		const now = this.#deps.now();
		const key = `${context.repoRootPath}\u0000${context.branch}`;
		const decision = decideFetch(
			{
				remote: context.remote,
				targetBranch: branchNameWithoutRemote(context.targetBranch, context.remote),
				branch: context.branch,
				prBaseOid: pullRequestOids.prBaseOid,
				prHeadOid: pullRequestOids.prHeadOid,
				localBaseOid: localBase.value,
				upstreamOid: upstream.value,
				// This service has no Graphite stack data, so the stored target is a remote branch.
				baseIsLocalStackParent: false,
			},
			this.#lastFetchAt.get(key) ?? null,
			now,
		);
		if (!decision.fetch) return ok({ fetched: false });

		// Record the attempt before the command runs, so two overlapping calls cannot both fetch.
		this.#recordFetchAttempt(key, now);
		const fetched = await this.#deps.git.runChecked(fetch(context.remote, decision.refspecs), {
			cwd: context.workspacePath,
		});
		if (!fetched.ok) return fetched;

		const refreshed = await this.#refreshNow(workspaceId, "full");
		if (!refreshed.ok) return refreshed;
		return ok({ fetched: true });
	}

	/**
	 * Records when a fetch was attempted. An entry older than the minimum gap can no longer block
	 * a fetch, so it is dropped here instead of growing the map for the life of the process.
	 */
	#recordFetchAttempt(key: string, now: number): void {
		for (const [storedKey, at] of this.#lastFetchAt) {
			if (now - at >= FETCH_MIN_GAP_MS) this.#lastFetchAt.delete(storedKey);
		}
		this.#lastFetchAt.set(key, now);
	}

	/** The commit a remote-tracking ref points at, or null when the ref does not exist. */
	async #remoteOid(cwd: string, ref: string): Promise<Result<string | null>> {
		if (ref.length === 0) return ok(null);
		const result = await this.#deps.git.run(revParseVerify(ref), { cwd });
		if (!result.ok) return result;
		if (result.value.exitCode === 0) {
			const oid = result.value.stdout.trim();
			return oid.length === 0
				? err(appError("git_parse", `git rev-parse returned no commit for ${ref}.`))
				: ok(oid);
		}
		if (result.value.exitCode === 1) return ok(null);
		return err(
			appError(
				"git_failed",
				result.value.stderr.trim() || `git rev-parse exited with code ${result.value.exitCode}`,
			),
		);
	}

	/** Backs `Actions.git.setViewed`. The mark resets when the file's modified time changes. */
	async setViewed(workspaceId: WorkspaceId, path: string, viewed: boolean): Promise<Result<void>> {
		const checked = workspaceRelativePath(path);
		if (!checked.ok) return checked;
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		// Two quick marks must reach the file in the order they were made, each with the other's mark.
		return this.#viewedQueue.run(String(workspaceId), async () => {
			const loaded = await this.#loadViewedNow(workspaceId);
			if (!loaded.ok) return loaded;
			const key = this.#viewedKey(workspaceId, path);
			this.#viewed.set(key, {
				viewed,
				fingerprint: await this.#viewedFingerprint(found.value.workspacePath, path),
			});
			return this.#saveViewed(workspaceId);
		});
	}

	#viewedKey(workspaceId: WorkspaceId, path: string): string {
		return `${String(workspaceId)}\u0000${path}`;
	}

	async #viewedFingerprint(cwd: string, path: string): Promise<string> {
		const result = await this.#deps.fs.stat(`${cwd}/${path}`);
		return result.ok ? `${result.value.modifiedAt}:${result.value.size}` : "";
	}

	/**
	 * Reads the saved marks once per workspace. A missing file means there are none. Any other
	 * error, including damaged JSON, is returned so the caller does not save an empty map over the
	 * user's marks. The workspace is only marked loaded after a successful read.
	 */
	#loadViewed(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#viewedQueue.run(String(workspaceId), () => this.#loadViewedNow(workspaceId));
	}

	async #loadViewedNow(workspaceId: WorkspaceId): Promise<Result<void>> {
		const key = String(workspaceId);
		if (this.#viewedLoaded.has(key)) return ok(undefined);
		const read = await this.#deps.fs.readText(viewedFilesFile(this.#deps.fs.paths, key));
		if (!read.ok) {
			if (read.error.code === "fs_not_found") {
				this.#viewedLoaded.add(key);
				return ok(undefined);
			}
			return read;
		}
		let parsed: Partial<ViewedFile>;
		try {
			parsed = JSON.parse(read.value) as Partial<ViewedFile>;
		} catch (cause) {
			return err(appError("invalid_json", "The viewed file marks could not be read.", cause));
		}
		for (const [path, mark] of Object.entries(parsed.marks ?? {})) {
			if (typeof mark?.viewed === "boolean" && typeof mark.fingerprint === "string") {
				this.#viewed.set(this.#viewedKey(workspaceId, path), mark);
			}
		}
		this.#viewedLoaded.add(key);
		return ok(undefined);
	}

	async #saveViewed(workspaceId: WorkspaceId): Promise<Result<void>> {
		const prefix = `${String(workspaceId)}\u0000`;
		const marks: Record<string, ViewedMark> = {};
		for (const [key, mark] of this.#viewed) {
			if (mark.viewed && key.startsWith(prefix)) marks[key.slice(prefix.length)] = mark;
		}
		const file = viewedFilesFile(this.#deps.fs.paths, String(workspaceId));
		const folder = file.slice(0, file.lastIndexOf("/"));
		const made = await this.#deps.fs.mkdirp(folder);
		if (!made.ok) return made;
		const body: ViewedFile = { version: 1, marks };
		return this.#deps.fs.writeTextAtomic(file, JSON.stringify(body));
	}

	async #applyViewed(
		workspaceId: WorkspaceId,
		cwd: string,
		files: readonly FileChange[],
	): Promise<(FileChange & { viewed: boolean })[]> {
		// A read failure leaves every file unviewed on screen; `setViewed` reports it and saves nothing.
		const loaded = await this.#loadViewed(workspaceId);
		if (!loaded.ok) return files.map((file) => ({ ...file, viewed: false }));
		return Promise.all(
			files.map(async (file) => {
				const key = this.#viewedKey(workspaceId, file.path);
				const mark = this.#viewed.get(key);
				if (mark === undefined) return { ...file, viewed: false };
				const fingerprint = await this.#viewedFingerprint(cwd, file.path);
				if (mark.fingerprint !== fingerprint) {
					this.#viewed.delete(key);
					return { ...file, viewed: false };
				}
				return { ...file, viewed: mark.viewed };
			}),
		);
	}

	/** Backs `Actions.git.discardFile`. */
	async discardFile(workspaceId: WorkspaceId, path: string): Promise<Result<void>> {
		const checked = workspaceRelativePath(path);
		if (!checked.ok) return checked;
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const cwd = found.value.workspacePath;
		const resolved = await this.resolveScope(workspaceId, { kind: "branch" });
		if (!resolved.ok) return resolved;
		const from = resolved.value.from;
		const changes = await this.changedFiles(workspaceId, { kind: "branch" });
		if (!changes.ok) return changes;
		const entry = changes.value.find((file) => file.path === path);
		const source = entry?.oldPath ?? path;
		// Only a clear "not in the base" may lead to the Trash. Any other failure stops here.
		const exists = await this.#deps.git.run(catFileExists(`${from}:${source}`), { cwd });
		if (!exists.ok) return exists;
		const inBase = this.#baseHasFile(exists.value);
		if (!inBase.ok) return inBase;

		return this.#deps.git.withWorktreeLock(cwd, async () => {
			if (!inBase.value) {
				// A file the branch added: unstage it, then move the new file to the Trash.
				const unstage = await this.#deps.git.runChecked(restoreStaged(path), { cwd });
				if (!unstage.ok) return unstage;
				return this.#deps.fs.trash(`${cwd}/${path}`);
			}
			const restore = await this.#deps.git.runChecked(restoreFromSource(from, source), { cwd });
			if (!restore.ok) return restore;
			if (entry?.oldPath !== undefined && entry.oldPath !== path) {
				const remove = await this.#deps.git.runChecked(removeCached(path), { cwd });
				if (!remove.ok) return remove;
			}
			return ok(undefined);
		});
	}

	/** Reads `git cat-file -e`: 0 is present, 1 or git's "does not exist in" is absent, else an error. */
	#baseHasFile(output: { exitCode: number; stderr: string }): Result<boolean> {
		if (output.exitCode === 0) return ok(true);
		if (output.exitCode === 1) return ok(false);
		if (output.exitCode === 128 && MISSING_IN_BASE.test(output.stderr)) return ok(false);
		return err(
			appError(
				"git_failed",
				output.stderr.trim() || `git cat-file exited with code ${output.exitCode}`,
			),
		);
	}

	/** Backs `Actions.git.commitAndPush`: sends the agent the commit instruction. */
	async commitAndPush(workspaceId: WorkspaceId): Promise<Result<void>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return context;
		const found = context.value;
		const text = commitAndPushInstruction({
			remote: found.remote,
			branch: found.branch,
		});
		const sent = await this.#deps.agent.sendInstruction(workspaceId, text);
		return sent.ok ? ok(undefined) : sent;
	}

	/**
	 * Backs `Actions.git.pull`. Fetches the target, rechecks the tree under the lock, then merges
	 * fast-forward only. A dirty or diverged tree goes to the agent, except under `pull.ff = only`,
	 * where git's own fast-forward-only refusal is returned instead (services-map 3.6.4).
	 */
	pull(workspaceId: WorkspaceId): Promise<Result<PullOutcome>> {
		return this.#flights.run(`pull:${workspaceId}`, () => this.#pullNow(workspaceId));
	}

	/** Backs `Actions.git.push`. A known upstream is pushed to; a first push sets it up. Never forces. */
	push(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#flights.run(`push:${workspaceId}`, () => this.#pushNow(workspaceId));
	}

	async #pushNow(workspaceId: WorkspaceId): Promise<Result<void>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;
		const cwd = context.workspacePath;
		const remote = context.remote.trim();
		const branch = context.branch.trim();
		// With no remote or branch information, git's own plain push is the only thing to run.
		if (remote.length === 0 || branch.length === 0) {
			return this.#deps.git.withWorktreeLock(cwd, async () =>
				discardValue(await this.#deps.git.runChecked(pushPlain(), { cwd })),
			);
		}

		const upstream = await this.#deps.git.stdout(upstreamName(), { cwd });
		if (!upstream.ok) return upstream;
		const known = upstreamBranchOn(upstream.value, remote);
		if (known !== null) {
			return this.#deps.git.withWorktreeLock(cwd, async () =>
				discardValue(await this.#deps.git.runChecked(pushHeadTo(remote, known), { cwd })),
			);
		}

		return this.#deps.git.withWorktreeAndRepoLocks(cwd, context.repoRootPath, async () => {
			const configuredRemote = await this.#deps.git.stdout(configGet(`branch.${branch}.remote`), {
				cwd,
			});
			if (!configuredRemote.ok) return configuredRemote;
			const configuredMerge = await this.#deps.git.stdout(configGet(`branch.${branch}.merge`), {
				cwd,
			});
			if (!configuredMerge.ok) return configuredMerge;
			const remoteBranch = firstPushRemoteBranch({
				branch,
				remote,
				configuredRemote: configuredRemote.value,
				configuredMerge: configuredMerge.value,
			});
			for (const command of firstPushSteps(remote, branch, remoteBranch)) {
				const result = await this.#deps.git.runChecked(command, { cwd });
				if (!result.ok) return result;
			}
			return ok(undefined);
		});
	}

	async #pullNow(workspaceId: WorkspaceId): Promise<Result<PullOutcome>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;
		const cwd = context.workspacePath;
		const remote = context.remote.trim();
		const branch = context.branch.trim().length > 0 ? context.branch.trim() : "HEAD";
		const targetRef =
			context.targetBranch.trim().length > 0
				? remoteTargetRef(context.targetBranch, context.remote)
				: "";

		// With no target there is nothing to compare against, so git's plain pull follows the
		// user's own pull.rebase and pull.ff settings.
		if (remote.length === 0 || targetRef.length === 0) {
			const pulled = await this.#deps.git.withWorktreeLock(cwd, () =>
				this.#deps.git.runChecked(pullCommand(), { cwd }),
			);
			return pulled.ok ? ok("plain") : pulled;
		}

		const choice = await this.#pullStrategyOf(cwd);
		if (!choice.ok) return choice;
		const agentStrategy = choice.value.agent;
		const ffOnly = choice.value.ffOnly;

		// `pull.ff = only` forbids both a merge commit and a rebase, so a dirty tree is never
		// handed off to the agent; git's own fast-forward-only check decides.
		if (!ffOnly) {
			const dirty = await this.#isDirty(cwd);
			if (!dirty.ok) return dirty;
			if (dirty.value) return this.#handOffOutcome(workspaceId, context, agentStrategy, true);
		}

		const fetched = await this.#deps.git.runChecked(fetch(remote), { cwd });
		if (!fetched.ok) return fetched;

		type PullStep =
			| { kind: "done"; outcome: PullOutcome }
			| { kind: "hand_off"; strategy: AgentPullStrategy; dirty: boolean };
		const step = await this.#deps.git.withWorktreeLock(cwd, async (): Promise<Result<PullStep>> => {
			// The tree may have changed while the fetch ran; check again under the lock.
			if (!ffOnly) {
				const rechecked = await this.#isDirty(cwd);
				if (!rechecked.ok) return rechecked;
				if (rechecked.value) {
					return ok({ kind: "hand_off", strategy: agentStrategy, dirty: true });
				}
			}

			const counts = await this.#deps.git.stdout(revListLeftRightCount(branch, targetRef), {
				cwd,
			});
			if (!counts.ok) return counts;
			const parsed = parseLeftRightCount(counts.value);
			if (!parsed.ok) return parsed;
			const ahead = parsed.value.left;
			const behind = parsed.value.right;
			if (behind === 0) return ok({ kind: "done", outcome: "up_to_date" });
			// A branch that is only behind fast-forwards. `pull.ff = only` also stops here,
			// because the user forbade both a merge commit and a rebase.
			if (ahead === 0 || ffOnly) {
				const merged = await this.#deps.git.runChecked(mergeFastForwardOnly(targetRef), {
					cwd,
				});
				return merged.ok ? ok({ kind: "done", outcome: "fast_forwarded" }) : merged;
			}
			return ok({ kind: "hand_off", strategy: agentStrategy, dirty: false });
		});
		if (!step.ok) return step;
		if (step.value.kind === "done") return ok(step.value.outcome);
		return this.#handOffOutcome(workspaceId, context, step.value.strategy, step.value.dirty);
	}

	async #isDirty(cwd: string): Promise<Result<boolean>> {
		const status = await this.#deps.git.stdout(statusPorcelainAll(), { cwd });
		return status.ok ? ok(status.value.trim().length > 0) : status;
	}

	/** Sends the pull's hand-off, then reports that the agent owns the rest of the work. */
	async #handOffOutcome(
		workspaceId: WorkspaceId,
		context: WorkspaceGitContext,
		strategy: AgentPullStrategy,
		dirty: boolean,
	): Promise<Result<PullOutcome>> {
		const sent = await this.#handOffPull(workspaceId, context, strategy, dirty);
		return sent.ok ? ok("handed_to_agent") : sent;
	}

	/** Sends the target and the chosen strategy to the agent, which commits, rebases or merges. */
	async #handOffPull(
		workspaceId: WorkspaceId,
		context: WorkspaceGitContext,
		strategy: AgentPullStrategy,
		dirty: boolean,
	): Promise<Result<void>> {
		const sent = await this.#deps.agent.sendInstruction(
			workspaceId,
			reconcileInstruction({
				remote: context.remote,
				targetBranch: targetBranchName(context.targetBranch, context.remote),
				branch: context.branch,
				strategy,
				dirty,
			}),
		);
		return sent.ok ? ok(undefined) : err(sent.error);
	}

	/**
	 * Backs `Actions.git.resolveConflicts`: reads `pull.rebase`, then sends the agent the rebase or
	 * merge instruction. An unset config means merge (services-map 3.6.4, 3.7.6).
	 */
	async resolveConflicts(workspaceId: WorkspaceId): Promise<Result<void>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return context;
		const found = context.value;
		const strategy = await this.#rebaseChoiceOf(found.workspacePath);
		if (!strategy.ok) return strategy;
		const promptFor = this.#deps.promptFor;
		if (promptFor === undefined) {
			return err(
				appError(
					"repo_config_unloaded",
					"The repository settings are not available, so the Resolve conflicts request cannot be built.",
				),
			);
		}
		const custom = await promptFor(workspaceId);
		if (!custom.ok) return custom;

		const text = resolveConflictsInstruction({
			remote: found.remote.trim(),
			targetBranch: targetBranchName(found.targetBranch, found.remote),
			branch: found.branch,
			customPrompt: custom.value,
			strategy: strategy.value,
		});
		const sent = await this.#deps.agent.sendInstruction(workspaceId, text);
		return sent.ok ? ok(undefined) : err(sent.error);
	}

	/**
	 * The rebase or merge choice from `pull.rebase` alone. Resolve conflicts follows this setting
	 * whatever `pull.ff` says, because the agent is rewriting or merging the branch itself. An
	 * unset key means merge (services-map 3.6.4).
	 */
	async #rebaseChoiceOf(cwd: string): Promise<Result<AgentPullStrategy>> {
		const rebase = await this.#deps.git.stdout(configPullRebase(), { cwd });
		return rebase.ok ? ok(pullRebaseStrategy(rebase.value)) : rebase;
	}

	/**
	 * Reads `pull.rebase` and `pull.ff` once. `agent` is what an agent instruction asks for, so
	 * a pull follows `pull.rebase` even when `pull.ff = only` stops it from handing work off. An
	 * unset key means merge (services-map 3.6.4).
	 */
	async #pullStrategyOf(
		cwd: string,
	): Promise<Result<{ agent: AgentPullStrategy; ffOnly: boolean }>> {
		const rebase = await this.#deps.git.stdout(configPullRebase(), { cwd });
		if (!rebase.ok) return rebase;
		const ff = await this.#deps.git.stdout(configPullFf(), { cwd });
		if (!ff.ok) return ff;
		const strategy = pullStrategy(rebase.value, ff.value);
		return ok({
			agent: strategy === "ff_only" ? pullRebaseStrategy(rebase.value) : strategy,
			ffOnly: strategy === "ff_only",
		});
	}

	/**
	 * Backs `Actions.workspaces.setTargetBranch`. Stores the chosen target, then moves an open pull
	 * request's base. Without an open pull request it fetches the new target and resets the branch
	 * only when the tree is clean and still at the old target (services-map 3.11).
	 */
	async setTargetBranch(workspaceId: WorkspaceId, branch: string): Promise<Result<void>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;
		const parsed = parseTargetBranch(context.remote, branch);
		if (!parsed.ok) return parsed;
		const branchName = parsed.value;

		const stored = await this.#deps.setIntendedTargetBranch(workspaceId, branchName);
		if (!stored.ok) return stored;

		const moved = await this.#deps.moveOpenPullRequestBase(workspaceId, branchName);
		if (!moved.ok) return moved;
		if (moved.value) return ok(undefined);

		return this.#deps.git.withWorktreeAndRepoLocks(
			context.workspacePath,
			context.repoRootPath,
			async (): Promise<Result<void>> => {
				const fetched = await this.#deps.git.runChecked(
					fetchBranchRefspec(context.remote, branchName),
					{ cwd: context.workspacePath },
				);
				if (!fetched.ok) return fetched;

				const clean = await this.#deps.git.stdout(statusPorcelainAll(), {
					cwd: context.workspacePath,
				});
				if (!clean.ok) return clean;
				if (clean.value.length > 0) return ok(undefined);

				const oldTarget = context.targetBranch;
				if (oldTarget.length === 0) return ok(undefined);
				const oldRef = remoteTargetRef(oldTarget, context.remote);
				const oldExists = await this.#refExists(context.workspacePath, oldRef);
				if (!oldExists.ok) return oldExists;
				if (!oldExists.value) return ok(undefined);

				const [head, oldSha] = await Promise.all([
					this.#deps.git.stdout(revParseHead(), { cwd: context.workspacePath }),
					this.#deps.git.stdout(revParse(oldRef), { cwd: context.workspacePath }),
				]);
				if (!head.ok) return head;
				if (!oldSha.ok) return oldSha;
				if (head.value !== oldSha.value) return ok(undefined);

				const newRef = remoteTargetRef(branchName, context.remote);
				const newExists = await this.#refExists(context.workspacePath, newRef);
				if (!newExists.ok) return newExists;
				if (!newExists.value) return ok(undefined);

				const reset = await this.#deps.git.runChecked(resetHard(newRef), {
					cwd: context.workspacePath,
				});
				return reset.ok ? ok(undefined) : reset;
			},
		);
	}

	/**
	 * Backs the `setTargetBranch` agent tool: checks the branch is on the remote and stores it. It
	 * does not rebase or change an open pull request (claude-runner.md 4.2, SIDE-12).
	 */
	async setTargetBranchFromAgent(workspaceId: WorkspaceId, branch: string): Promise<Result<void>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;
		const parsed = parseTargetBranch(context.remote, branch);
		if (!parsed.ok) return parsed;
		const branchName = parsed.value;
		const ref = remoteTargetRef(branchName, context.remote);
		const exists = await this.#refExists(context.workspacePath, ref);
		if (!exists.ok) return exists;
		if (!exists.value) {
			return err(
				appError(
					"target_branch_missing",
					`The branch "${branchName}" is not on ${context.remote}. Run git fetch ${context.remote} ${branchName} first.`,
				),
			);
		}
		return this.#deps.setIntendedTargetBranch(workspaceId, branchName);
	}

	/**
	 * Backs `Actions.git.renameBranch`: checks the name, then renames and saves under the worktree
	 * lock. The old remote branch is left in place.
	 */
	async renameBranch(workspaceId: WorkspaceId, rawName: string): Promise<Result<void>> {
		const name = rawName.trim();
		if (!isSafeRefName(name)) {
			return err(
				appError("workspace_branch_invalid", `"${name}" can't be used as a Git branch name.`),
			);
		}

		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;
		return renameBranchInWorktree(this.#deps.git, {
			worktreePath: context.workspacePath,
			repoRootPath: context.repoRootPath,
			remote: context.remote,
			requestedName: name,
			onRenamed: (branch) => this.#deps.renameWorkspaceBranch(workspaceId, branch),
		});
	}

	/**
	 * Backs `Actions.git.switchBranch`: fetches the branch, checks it out, then fast-forwards it
	 * when HEAD is behind its remote-tracking ref (services-map 3.11). Its own mutex runs one
	 * switch at a time for a workspace, apart from the other git actions.
	 */
	switchBranch(workspaceId: WorkspaceId, branch: string): Promise<Result<void>> {
		return this.#switchQueue.run(`switch:${String(workspaceId)}`, () =>
			this.#switchBranchNow(workspaceId, branch),
		);
	}

	async #switchBranchNow(workspaceId: WorkspaceId, branch: string): Promise<Result<void>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;
		const name = branchNameWithoutRemote(branch.trim(), context.remote);
		if (!isSafeRefName(name)) {
			return err(
				appError("workspace_branch_invalid", `"${name}" can't be used as a Git branch name.`),
			);
		}

		const cwd = context.workspacePath;
		const remote = context.remote.trim();
		const switched = await this.#deps.git.withWorktreeLock(cwd, async (): Promise<Result<void>> => {
			// A branch that exists locally can still be checked out when the fetch fails, because
			// the user may be offline; a branch known only on the remote needs the fetch.
			if (remote.length > 0) {
				const fetched = await this.#deps.git.runChecked(fetchBranchRefspec(remote, name), { cwd });
				if (!fetched.ok) {
					const local = await this.#refExists(cwd, `refs/heads/${name}`);
					if (!local.ok) return local;
					if (!local.value) return fetched;
				}
			}

			const checkedOut = await this.#deps.git.runChecked(checkout(name), { cwd });
			if (!checkedOut.ok) return checkedOut;

			// Only the branch git actually checked out may lead to a fast-forward.
			const head = await this.#deps.git.stdout(symbolicRefHead(), { cwd });
			if (!head.ok) return head;
			const headName = head.value.replace(/^refs\/heads\//, "");
			if (headName !== name) {
				return err(
					appError("git_branch_mismatch", `Git checked out "${headName}" instead of "${name}".`),
				);
			}

			if (remote.length === 0) return ok(undefined);
			const remoteRef = `refs/remotes/${remote}/${name}`;
			const exists = await this.#refExists(cwd, remoteRef);
			if (!exists.ok) return exists;
			if (!exists.value) return ok(undefined);

			const ancestor = await this.#deps.git.run(isAncestor("HEAD", remoteRef), { cwd });
			if (!ancestor.ok) return ancestor;
			if (ancestor.value.exitCode === 1) return ok(undefined);
			if (ancestor.value.exitCode !== 0) {
				return err(
					appError(
						"git_failed",
						ancestor.value.stderr.trim() ||
							`git merge-base exited with code ${ancestor.value.exitCode}`,
					),
				);
			}

			const merged = await this.#deps.git.runChecked(mergeFastForwardOnly(remoteRef), { cwd });
			return merged.ok ? ok(undefined) : merged;
		});
		if (!switched.ok) return switched;

		// The workspace row and the poll both need the new name before the changes are read again.
		const saved = await this.#deps.renameWorkspaceBranch(workspaceId, name);
		if (!saved.ok) return saved;
		return this.#refreshNow(workspaceId, "full");
	}

	/**
	 * Backs `Actions.git.continueOnNewBranch`: creates a branch in the same worktree and keeps the
	 * chats. After a merge it starts from the target; from a detached HEAD it starts from HEAD. The
	 * note tells the open chat that the branch changed.
	 */
	async continueOnNewBranch(workspaceId: WorkspaceId, name: string | null): Promise<Result<void>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const context = found.value;
		const requested = name?.trim() ?? "";
		if (requested !== "" && !isSafeRefName(requested)) {
			return err(
				appError("workspace_branch_invalid", `"${requested}" can't be used as a Git branch name.`),
			);
		}

		return this.#deps.git.withWorktreeLock(
			context.workspacePath,
			async (): Promise<Result<void>> => {
				const current = await this.#deps.git.stdout(branchShowCurrent(), {
					cwd: context.workspacePath,
				});
				if (!current.ok) return current;
				const previousBranch = current.value.trim();
				const detached = previousBranch === "";

				const start = detached
					? await this.#detachedStart(context.workspacePath)
					: await this.#targetStart(context);
				if (!start.ok) return start;

				const base = requested !== "" ? requested : previousBranch || "continue";
				const free = await freeBranchName(this.#deps.git, {
					repoRootPath: context.repoRootPath,
					remote: context.remote.trim(),
					base,
				});
				if (!free.ok) return free;
				const newBranch = free.value;

				const checkedOut = await this.#deps.git.runChecked(
					checkoutNewBranch(newBranch, start.value.sha),
					{ cwd: context.workspacePath },
				);
				if (!checkedOut.ok) return checkedOut;

				const saved = await this.#deps.renameWorkspaceBranch(workspaceId, newBranch);
				if (!saved.ok) {
					// The workspace record still names the old branch, so the worktree goes back to it.
					const back = detached ? start.value.sha : previousBranch;
					return this.#undoContinue(context.workspacePath, back, newBranch, saved.error);
				}
				this.store.setState((state) => ({
					continuedAt: { ...state.continuedAt, [String(workspaceId)]: this.#deps.now() },
				}));

				const text = continueNoteText({
					previousBranch,
					newBranch,
					startRef: start.value.ref,
				});
				const written = await this.#writeContinueNote(context.workspacePath, text);
				if (!written.ok) {
					return err(appError("continue_note_failed", CONTINUE_NOTE_FAILED_MESSAGE, written.error));
				}
				const sent = await this.#deps.agent.sendInstruction(workspaceId, text);
				return sent.ok
					? ok(undefined)
					: err(appError("continue_note_failed", CONTINUE_NOTE_FAILED_MESSAGE, sent.error));
			},
		);
	}

	/**
	 * Puts the worktree back where it was after the workspace could not save the new branch, and
	 * removes that branch, which has no commits of its own yet. The save error is returned either
	 * way. When going back fails, the error says the worktree stayed on the new branch, with the
	 * code `continue_branch_unsaved`, so the panel reads the git state again.
	 */
	async #undoContinue(
		workspacePath: string,
		back: string,
		newBranch: string,
		saveError: AppError,
	): Promise<Result<void>> {
		const options = { cwd: workspacePath };
		const returned = await this.#deps.git.runChecked(checkout(back), options);
		if (!returned.ok) {
			return err(
				appError(
					"continue_branch_unsaved",
					`The workspace couldn't save the new branch ${newBranch}, and the worktree stayed on it.`,
					saveError,
				),
			);
		}
		const removed = await this.#deps.git.runChecked(branchDeleteForce(newBranch), options);
		if (!removed.ok) {
			return err(
				appError(
					saveError.code,
					`${saveError.message} The unused branch ${newBranch} could not be removed.`,
					removed.error,
				),
			);
		}
		return err(saveError);
	}

	/** A detached HEAD continues from the commit it points at. */
	async #detachedStart(workspacePath: string): Promise<Result<{ sha: string; ref: string }>> {
		const head = await this.#deps.git.stdout(revParseHead(), { cwd: workspacePath });
		return head.ok ? ok({ sha: head.value, ref: "HEAD" }) : head;
	}

	/** A merged branch continues from the target branch, fetched first when there is a remote. */
	async #targetStart(context: WorkspaceGitContext): Promise<Result<{ sha: string; ref: string }>> {
		const remote = context.remote.trim();
		const baseBranch = targetBranchName(context.targetBranch, remote);
		if (baseBranch === "") {
			return err(
				appError("git_base_missing", "This workspace has no target branch to continue from."),
			);
		}
		if (remote === "") {
			const local = await this.#deps.git.stdout(revParse(`refs/heads/${baseBranch}`), {
				cwd: context.workspacePath,
			});
			return local.ok ? ok({ sha: local.value, ref: baseBranch }) : local;
		}
		const resolved = await resolveBaseCommit(this.#deps.git, {
			repoRootPath: context.repoRootPath,
			remote,
			baseBranch,
			allowLocalBase: false,
		});
		return resolved.ok ? ok({ sha: resolved.value.baseSha, ref: baseBranch }) : resolved;
	}

	/** Writes the note under the workspace's `.context` folder, which git leaves alone. */
	async #writeContinueNote(workspacePath: string, text: string): Promise<Result<void>> {
		const folder = `${workspacePath.replace(/\/+$/, "")}/${CONTINUE_NOTE_FOLDER}`;
		const made = await this.#deps.fs.mkdirp(folder);
		if (!made.ok) return made;
		return this.#deps.fs.writeTextAtomic(`${folder}/${CONTINUE_NOTE_FILE_NAME}`, text);
	}

	/**
	 * Reads a workspace's sparse checkout settings. Git keeps them, so nothing is stored in our
	 * database. When sparse checkout is off, the directory list is empty.
	 */
	async sparseCheckoutSettings(workspaceId: WorkspaceId): Promise<Result<SparseCheckoutSettings>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const cwd = found.value.workspacePath;

		const enabled = await this.#sparseCheckoutEnabled(cwd);
		if (!enabled.ok) return enabled;
		const directories = enabled.value
			? await this.#deps.git.stdout(sparseCheckoutList(), { cwd })
			: ok("");
		if (!directories.ok) return directories;
		const topLevel = await this.#deps.git.stdout(lsTreeTopLevelDirectories(), { cwd });
		if (!topLevel.ok) return topLevel;

		return ok({
			enabled: enabled.value,
			directories: enabled.value ? parseSparseCheckoutDirectories(directories.value) : [],
			topLevelDirectories: parseSparseCheckoutDirectories(topLevel.value),
		});
	}

	/**
	 * Edits a workspace's sparse checkout. An empty list turns sparse checkout off; otherwise the
	 * chosen directories are set in cone mode, initialising it first when it was off. The change
	 * waits for the worktree lock, because git rewrites the worktree's index and files.
	 */
	async setSparseCheckoutDirectories(
		workspaceId: WorkspaceId,
		directories: readonly string[],
	): Promise<Result<void>> {
		const checked = checkedSparseCheckoutDirectories(directories);
		if (!checked.ok) return checked;
		if (checked.value.length === 0) return this.disableSparseCheckout(workspaceId);

		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const cwd = found.value.workspacePath;
		return this.#deps.git.withWorktreeLock(cwd, async () => {
			const enabled = await this.#sparseCheckoutEnabled(cwd);
			if (!enabled.ok) return enabled;
			if (!enabled.value) {
				const initialised = await this.#deps.git.runChecked(sparseCheckoutInitCone(), { cwd });
				if (!initialised.ok) return initialised;
			}
			const set = await this.#deps.git.runChecked(sparseCheckoutSet(checked.value), { cwd });
			return set.ok ? ok(undefined) : set;
		});
	}

	/** Turns a workspace's sparse checkout off, so the whole tree is present again. */
	async disableSparseCheckout(workspaceId: WorkspaceId): Promise<Result<void>> {
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const cwd = found.value.workspacePath;
		return this.#deps.git.withWorktreeLock(cwd, async () => {
			const disabled = await this.#deps.git.runChecked(sparseCheckoutDisable(), { cwd });
			return disabled.ok ? ok(undefined) : disabled;
		});
	}

	/** True when git's `core.sparseCheckout` is on. A missing key means off, not a failure. */
	async #sparseCheckoutEnabled(cwd: string): Promise<Result<boolean>> {
		const result = await this.#deps.git.run(sparseCheckoutConfig(), { cwd });
		if (!result.ok) return result;
		if (result.value.exitCode === 1) return ok(false);
		if (result.value.exitCode !== 0) {
			return err(
				appError(
					"git_failed",
					result.value.stderr.trim() || `git config exited with code ${result.value.exitCode}`,
				),
			);
		}
		const value = result.value.stdout.trim().toLowerCase();
		return ok(value === "true" || value === "1" || value === "yes" || value === "on");
	}

	/**
	 * Backs `Actions.git.openInDiffTool`: opens the file's changes in Kaleidoscope when the file
	 * has any. A file with no changes opens nothing and is not an error.
	 */
	async openInDiffTool(workspaceId: WorkspaceId, path: string): Promise<Result<void>> {
		const checked = workspaceRelativePath(path);
		if (!checked.ok) return checked;
		const found = await this.#deps.contextOf(workspaceId);
		if (!found.ok) return found;
		const cwd = found.value.workspacePath;

		const changed = await this.#deps.git.runChecked(diffQuietHead(checked.value), { cwd });
		if (!changed.ok) return changed;
		if (changed.value.exitCode === 0) return ok(undefined);
		const opened = await this.#deps.git.runChecked(diffToolKsdiff(checked.value), { cwd });
		return opened.ok ? ok(undefined) : opened;
	}
}
