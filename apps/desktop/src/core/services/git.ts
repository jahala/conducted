/**
 * @feature GIT-02 Git service: polling change state; GIT-06 Push and pull
 * Owns: polling each shown workspace's git state at the requested depth, the four-slot limiter,
 * and the last error per workspace. Also the two write actions that move a branch across the
 * remote: push, including the first push's upstream setup, and pull latest from the target, which
 * fetches, rechecks under the lock, fast-forwards or hands the work to the agent.
 * Behaviour: services-map.md 3.3.1 (schedule, depths, staleness, concurrency) and 3.3.3 (a
 * cheaper poll reads only the local branch, and an answer for a branch that has since changed is
 * dropped); 3.6.1 (push, upstream, first push, no force) and 3.6.4 (pull latest from target).
 * Must handle: every watched workspace polls every 5 s at the deepest depth any watcher asked
 * for; a result younger than 0.9 of the interval is reused; at most four refreshes at once
 * (the limiter runs foreground requests first, and every caller today is foreground); an answer
 * whose branch differs from the branch the request was made for is dropped; a failed poll keeps
 * the last snapshot and records the error; a path or commit id from a screen that could leave the
 * workspace or read as a git option is refused; discarding a file moves a file the branch added to
 * the Trash and stops when git cannot say whether the base has the file; viewed marks are saved
 * one write at a time per workspace; a push to a known upstream does not set it again; a first
 * push writes both branch keys and the remote-tracking ref; a dirty or diverged tree goes to the
 * agent; the user's own pull.rebase and pull.ff choose how a pull proceeds; a pull with nothing new
 * changes nothing; and a second push or pull while one runs joins the first instead of starting
 * another.
 * Not built yet: only the visible workspace polling fast (GIT-13 owns the fetching rules).
 * Our design choice: this class exposes snapshots and actions only. The Git header state machine
 * and the merge with pull request info belong to GIT-04, the other git actions (retarget, rename
 * and the rest) belong to their own features, and the restart cache belongs to DATA-07. Their
 * placeholders stay here until those features build them; the fetching rules belong to GIT-13.
 * Changing the target branch is here (GIT-08): it stores the intended branch, moves an open pull
 * request's base, or fetches and resets a clean branch still at the old target.
 * Test first: a workspace watched at depth full runs its poll immediately and again once the
 * interval has passed.
 */
import type { FileChange } from "@conducted/protocol";
import {
	type AppError,
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem, Unsubscribe } from "../../platform/platform.ts";
import type { ChangedFile, DiffScope } from "../api.ts";
import { viewedFilesFile } from "../app-paths.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { createKeyedQueue } from "../async/serial-queue.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import {
	catFileExists,
	configGet,
	configPullFf,
	configPullRebase,
	diffWorkingTree,
	fetch,
	fetchBranchRefspec,
	firstPushSteps,
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
	statusPorcelainAll,
	upstreamName,
} from "../git/commands.ts";
import { type ComparisonContext, resolveComparison } from "../git/diff.ts";
import { checkpointRef, turnCheckpointId } from "../git/refs.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	type ChangesSnapshot,
	diffTargetOf,
	mergeChanges,
	parseLeftRightCount,
	parseNameStatus,
	parseNumstat,
	readComparedChanges,
	refreshWorkspaceChanges,
	remoteTargetRef,
} from "../git/status.ts";
import type { GitState } from "../model.ts";
import { commitAndPushInstruction, reconcileInstruction } from "./agent-instructions.ts";
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

/** What `git cat-file -e` prints when the path is not in the base commit. */
const MISSING_IN_BASE = /(path .* does not exist in|exists on disk, but not in)/i;

export interface WorkspaceGitEntry {
	snapshot: ChangesSnapshot | null;
	error: { code: string; message: string } | null;
	refreshedAt: number | null;
}

export interface GitServiceState {
	byWorkspace: Readonly<Record<string, WorkspaceGitEntry>>;
}

export type PollDepth = "metadata" | "uncommitted" | "full";

/** How often a workspace on screen is polled (services-map 3.3.1). */
export const GIT_POLL_INTERVAL_MS = 5_000;
/** A result younger than this share of the interval is reused instead of polled again. */
export const POLL_FRESH_RATIO = 0.9;
/** Most changes refreshes that run at once (services-map 3.3.1). */
export const MAX_CONCURRENT_REFRESHES = 4;

/** Shown when a pull finds nothing to bring in. */
export const PULL_UP_TO_DATE_MESSAGE = "Pulled latest changes. You're up to date!";

/** `pull.rebase` values git treats as "rebase the local commits". */
const REBASE_TRUE = new Set(["true", "yes", "on", "1", "merges", "interactive", "preserve"]);

/** Whether the user's own `pull.rebase` asks for a rebase. Missing or false values mean merge. */
export const pullUsesRebase = (value: string | null): boolean =>
	REBASE_TRUE.has(value?.trim().toLowerCase() ?? "");

/** How a pull that cannot fast-forward proceeds: rebase, merge, or only a fast-forward. */
export type PullStrategy = "rebase" | "merge" | "ff_only";

/**
 * The strategy from the user's git config. `pull.ff = only` wins because it forbids both a merge
 * commit and a rebase; otherwise `pull.rebase` decides, and its absence means merge.
 */
export function pullStrategy(rebase: string | null, ff: string | null): PullStrategy {
	if (ff?.trim().toLowerCase() === "only") return "ff_only";
	return pullUsesRebase(rebase) ? "rebase" : "merge";
}

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

/** The commits GitHub reports for a pull request, and what the local refs hold (GIT-13). */
export interface FetchStaleness {
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

/**
 * Whether to fetch now. `lastFetchedAt` is the time of the last fetch for the same repository and
 * branch, or null when there was none. Pure: the caller reads the refs and the clock.
 */
export function decideFetch(
	_staleness: FetchStaleness,
	_lastFetchedAt: number | null,
	_now: number,
): FetchDecision {
	return notImplemented("GIT-13");
}

export interface GitServiceDeps {
	git: GitRunner;
	/** The last snapshot of each workspace, shown before the first poll answers (DATA-07). */
	cache: GitCache;
	/** Looks up folders and branch names for a workspace. Fails for unknown ids. */
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
	agent: AgentMessenger;
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
	readonly #latest = createLatestWins<string>();
	readonly #limiter = createRefreshLimiter();
	/** Viewed marks per workspace and path. Loaded from the file on first use. */
	readonly #viewed = new Map<string, ViewedMark>();
	readonly #viewedLoaded = new Set<string>();
	/** Loads and saves of one workspace's viewed marks run one after another. */
	readonly #viewedQueue = createKeyedQueue();
	/** A second push or pull while one runs joins the first (services-map 3.0.3). */
	readonly #flights = createSingleFlight<string>();

	constructor(deps: GitServiceDeps) {
		this.#deps = deps;
		this.store = createStore<GitServiceState>(() => ({ byWorkspace: {} }));
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
		// A metadata poll reads only the branch; every other part of the snapshot stays as it was.
		const snapshot =
			depth === "metadata" && previous !== null
				? { ...previous, branch: result.value.branch }
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
	 * GitHub service. Returns null until the first poll has stored a snapshot.
	 */
	stateOf(workspaceId: WorkspaceId, prEntry?: WorkspacePrEntry): GitState | null {
		const snapshot = this.store.getState().byWorkspace[String(workspaceId)]?.snapshot ?? null;
		if (snapshot === null) return null;
		const changedFiles = snapshot.files.length;
		return {
			branch: snapshot.branch ?? "",
			uncommittedFiles: changedFiles,
			changedFiles,
			linesAdded: snapshot.files.reduce((total, file) => total + file.linesAdded, 0),
			linesRemoved: snapshot.files.reduce((total, file) => total + file.linesRemoved, 0),
			hasConflicts: snapshot.conflictedPaths.length > 0,
			operation: snapshot.operation,
			sync: snapshot.sync,
			pullRequest: prEntry?.pullRequest ?? null,
			pullRequestUnavailable:
				prEntry === undefined
					? "loading"
					: prEntry.unavailable === "no_pr"
						? "none"
						: prEntry.unavailable,
			untrackedFilesTruncated: snapshot.untrackedTruncated,
			pendingPullRequestAction: null,
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

	/** Backs the `getWorkspaceDiff` agent tool: the diff against the merge base, or its stat. */
	async agentDiff(
		workspaceId: WorkspaceId,
		file: string | undefined,
		statOnly: boolean,
	): Promise<Result<string>> {
		const resolved = await this.resolveScope(workspaceId, { kind: "branch" });
		if (!resolved.ok) return resolved;
		const { cwd, from } = resolved.value;
		return this.#deps.git.stdout(diffWorkingTree(from, statOnly, file), { cwd });
	}

	/**
	 * Fetches the PR's base and head branches when the local remote-tracking refs are behind them,
	 * at most once per `FETCH_MIN_GAP_MS` for one repository and branch, then refreshes the
	 * workspace. `fetched` is false when `decideFetch` said not to.
	 */
	fetchIfStale(
		_workspaceId: WorkspaceId,
		_pullRequestOids: Pick<FetchStaleness, "prBaseOid" | "prHeadOid">,
	): Promise<Result<{ fetched: boolean }>> {
		void this.#lastFetchAt;
		return notImplemented("GIT-13");
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
			targetBranch: found.targetBranch,
			branch: found.branch,
			customPrompt: null,
		});
		const sent = await this.#deps.agent.sendInstruction(workspaceId, text);
		return sent.ok ? ok(undefined) : sent;
	}

	/**
	 * Backs `Actions.git.pull`. Fetches the target, rechecks the tree under the lock, then merges
	 * fast-forward only. A dirty or diverged tree goes to the agent (services-map 3.6.4).
	 */
	pull(workspaceId: WorkspaceId): Promise<Result<void>> {
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

	async #pullNow(workspaceId: WorkspaceId): Promise<Result<void>> {
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
			return this.#deps.git.withWorktreeLock(cwd, async () =>
				discardValue(await this.#deps.git.runChecked(pullCommand(), { cwd })),
			);
		}

		const rebase = await this.#deps.git.stdout(configPullRebase(), { cwd });
		if (!rebase.ok) return rebase;
		const ff = await this.#deps.git.stdout(configPullFf(), { cwd });
		if (!ff.ok) return ff;
		const strategy = pullStrategy(rebase.value, ff.value);
		const agentStrategy = strategy === "rebase" ? "rebase" : "merge";

		const dirty = await this.#isDirty(cwd);
		if (!dirty.ok) return dirty;
		if (dirty.value) return this.#handOffPull(workspaceId, context, agentStrategy, true);

		const fetched = await this.#deps.git.runChecked(fetch(remote), { cwd });
		if (!fetched.ok) return fetched;

		let handOff: { strategy: "rebase" | "merge"; dirty: boolean } | null = null;
		const outcome = await this.#deps.git.withWorktreeLock(
			cwd,
			async (): Promise<Result<{ handOff: typeof handOff }>> => {
				// The tree may have changed while the fetch ran; check again under the lock.
				const rechecked = await this.#isDirty(cwd);
				if (!rechecked.ok) return rechecked;
				if (rechecked.value) {
					return ok({ handOff: { strategy: agentStrategy, dirty: true } });
				}

				const counts = await this.#deps.git.stdout(revListLeftRightCount(branch, targetRef), {
					cwd,
				});
				if (!counts.ok) return counts;
				const parsed = parseLeftRightCount(counts.value);
				if (!parsed.ok) return parsed;
				const ahead = parsed.value.left;
				const behind = parsed.value.right;
				if (behind === 0) return ok({ handOff: null });
				// A branch that is only behind fast-forwards. `pull.ff = only` also stops here,
				// because the user forbade both a merge commit and a rebase.
				if (ahead === 0 || strategy === "ff_only") {
					const merged = await this.#deps.git.runChecked(mergeFastForwardOnly(targetRef), {
						cwd,
					});
					return merged.ok ? ok({ handOff: null }) : merged;
				}
				return ok({ handOff: { strategy: agentStrategy, dirty: false } });
			},
		);
		if (!outcome.ok) return outcome;
		handOff = outcome.value.handOff;
		if (handOff === null) return ok(undefined);
		return this.#handOffPull(workspaceId, context, handOff.strategy, handOff.dirty);
	}

	async #isDirty(cwd: string): Promise<Result<boolean>> {
		const status = await this.#deps.git.stdout(statusPorcelainAll(), { cwd });
		return status.ok ? ok(status.value.trim().length > 0) : status;
	}

	/** Sends the target and the chosen strategy to the agent, which commits, rebases or merges. */
	async #handOffPull(
		workspaceId: WorkspaceId,
		context: WorkspaceGitContext,
		strategy: "rebase" | "merge",
		dirty: boolean,
	): Promise<Result<void>> {
		const sent = await this.#deps.agent.sendInstruction(
			workspaceId,
			reconcileInstruction({
				remote: context.remote,
				targetBranch: targetBranchName(context.targetBranch, context.remote),
				branch: context.branch,
				customPrompt: null,
				strategy,
				dirty,
			}),
		);
		return sent.ok ? ok(undefined) : err(sent.error);
	}

	/** Backs `Actions.git.resolveConflicts`: sends the agent the resolve instruction. */
	resolveConflicts(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("GIT-07");
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
		const requested = branch.trim();
		if (!isSafeRefName(requested)) {
			return err(
				appError("workspace_branch_invalid", `"${requested}" can't be used as a Git branch name.`),
			);
		}

		const stored = await this.#deps.setIntendedTargetBranch(workspaceId, requested);
		if (!stored.ok) return stored;

		const branchName = branchNameWithoutRemote(requested, context.remote);
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

				const newRef = remoteTargetRef(requested, context.remote);
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
		const requested = branch.trim();
		if (!isSafeRefName(requested)) {
			return err(
				appError("workspace_branch_invalid", `"${requested}" can't be used as a Git branch name.`),
			);
		}
		const branchName = branchNameWithoutRemote(requested, context.remote);
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

	/** Backs `Actions.git.renameBranch`. */
	renameBranch(_workspaceId: WorkspaceId, _name: string): Promise<Result<void>> {
		return notImplemented("GIT-09");
	}

	/** Backs `Actions.git.switchBranch`. Has its own lock, apart from the other git actions. */
	switchBranch(_workspaceId: WorkspaceId, _branch: string): Promise<Result<void>> {
		return notImplemented("GIT-12");
	}

	/** Backs `Actions.git.continueOnNewBranch`, and tells the open chat that the branch changed. */
	continueOnNewBranch(_workspaceId: WorkspaceId, _name: string | null): Promise<Result<void>> {
		return notImplemented("GIT-17");
	}

	/** Backs `Actions.git.openInDiffTool`. */
	openInDiffTool(_workspaceId: WorkspaceId, _path: string): Promise<Result<void>> {
		return notImplemented("GIT-15");
	}
}
