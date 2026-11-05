/**
 * @feature GIT-02 Git service: polling change state
 * Owns: polling each shown workspace's git state at the requested depth, the four-slot limiter,
 * and the last error per workspace.
 * Behaviour: services-map.md 3.3.1 (schedule, depths, staleness, concurrency) and 3.3.3 (a
 * cheaper poll reads only the local branch, and an answer for a branch that has since changed is
 * dropped).
 * Must handle: only the visible workspace polls fast (5 s); a result younger than 0.9 of the
 * interval is reused; at most four refreshes at once, foreground first; an answer whose branch
 * differs from the branch the request was made for is dropped; a failed poll keeps the last
 * snapshot and records the error.
 * Our design choice: this class exposes snapshots only. The Git header state machine and the
 * merge with pull request info belong to GIT-04, the git actions (push, pull, retarget, rename,
 * discard and the rest) belong to their own features, and the restart cache belongs to DATA-07.
 * Their placeholders stay here until those features build them; the fetching rules belong to
 * GIT-13.
 * Test first: a workspace watched at depth full runs its poll immediately and again once the
 * interval has passed.
 */
import {
	type AppError,
	err,
	notImplemented,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "../../platform/platform.ts";
import type { ChangedFile, DiffScope } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import type { GitRunner } from "../git/runner.ts";
import { type ChangesSnapshot, diffTargetOf, refreshWorkspaceChanges } from "../git/status.ts";
import type { GitState } from "../model.ts";
import type { GitCache } from "./git-cache.ts";
import type { AgentMessenger } from "./sessions.ts";

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
}

export class GitService {
	readonly store: StoreApi<GitServiceState>;
	readonly #deps: GitServiceDeps;
	/** When each repository and branch was last fetched, keyed by root path and branch. */
	readonly #lastFetchAt = new Map<string, number>();
	readonly #watchers = new Map<string, Watcher>();
	readonly #latest = createLatestWins<string>();
	readonly #limiter = createRefreshLimiter();

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
			existing.depth = depth;
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

	/** Backs `useGitState`: the snapshot merged with PR info from the GitHub service. */
	stateOf(_workspaceId: WorkspaceId): GitState | null {
		return notImplemented("GIT-04");
	}

	/** Backs `useChangedFiles`. */
	changedFiles(_workspaceId: WorkspaceId, _scope: DiffScope): Promise<Result<ChangedFile[]>> {
		return notImplemented("REV-01");
	}

	/** Resolves a diff scope to the folder and the two refs to compare (see git/diff.ts). */
	resolveScope(
		_workspaceId: WorkspaceId,
		_scope: DiffScope,
	): Promise<Result<{ cwd: string; from: string; to: string | null }>> {
		return notImplemented("REV-01");
	}

	/** Backs the `getWorkspaceDiff` agent tool: the diff against the merge base, or its stat. */
	agentDiff(
		_workspaceId: WorkspaceId,
		_file: string | undefined,
		_statOnly: boolean,
	): Promise<Result<string>> {
		return notImplemented("REV-01");
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

	/** Backs `Actions.git.setViewed`. */
	setViewed(_workspaceId: WorkspaceId, _path: string, _viewed: boolean): Promise<Result<void>> {
		return notImplemented("REV-02");
	}

	/** Backs `Actions.git.discardFile`. */
	discardFile(_workspaceId: WorkspaceId, _path: string): Promise<Result<void>> {
		return notImplemented("REV-01");
	}

	/** Backs `Actions.git.commitAndPush`: sends the agent the commit instruction. */
	commitAndPush(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("GIT-05");
	}

	/** Backs `Actions.git.pull`. Fast-forward when the tree is clean, otherwise asks the agent. */
	pull(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("GIT-06");
	}

	/** Backs `Actions.git.push`. Never forces. */
	push(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("GIT-06");
	}

	/** Backs `Actions.git.resolveConflicts`: sends the agent the resolve instruction. */
	resolveConflicts(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("GIT-07");
	}

	/** Backs `Actions.workspaces.setTargetBranch` and the `setTargetBranch` agent tool. */
	setTargetBranch(_workspaceId: WorkspaceId, _branch: string): Promise<Result<void>> {
		return notImplemented("GIT-08");
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
