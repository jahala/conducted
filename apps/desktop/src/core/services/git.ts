/**
 * @feature GIT-02 Git service: change state, push, pull, retarget
 * Owns: polling each shown workspace's git state and the git actions
 * the Git panel offers. Commits, rebases and conflict repair are delegated to the agent.
 * Behaviour: services-map.md 3.3 (polling schedule and depths), 3.6 (push, pull, pull latest),
 * 3.11 (rename, retarget), 3.7.7, ui-map.md 3.6 (header table: title and main action per state).
 * Must handle: only the visible workspace polls fast (5 s); a refresh in flight when the branch
 * changed is dropped; refresh after any git action; a merge or rebase in progress shows "Finish
 * rebasing or merging" and no file list; pull and push run under the worktree lock and never
 * force; a push with no upstream sets it (first-push steps); "Commit and push" needs a chat (the
 * agent runs it); changing the target branch with an open PR only edits the PR base, otherwise it
 * fetches and resets the worktree to the new target only when the tree is clean and still at the
 * old target; a rename of a branch with an upstream keeps the old remote branch (warn); discarding
 * a file restores it from the merge base or checkpoint and cannot be undone (the UI confirms).
 * Our design choice: the header is a pure function in status/git-header.ts, so every surface that
 * shows the state agrees. This service only gathers its inputs.
 * Fetching (GIT-13, services-map.md 3.0.2 and 3.3.4): the app never fetches on a timer. After a
 * changes refresh it compares the PR's base and head commits with the local remote-tracking refs,
 * fetches only when they differ, and at most once per 60 seconds for one repository and branch. A
 * base that is a local stack parent is never fetched. Two callers asking at once share one fetch.
 * Test first: stateOf merges the polled snapshot with PR info from the GitHub service.
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "../../platform/platform.ts";
import type { ChangedFile, DiffScope } from "../api.ts";
import type { GitRunner } from "../git/runner.ts";
import type { ChangesSnapshot } from "../git/status.ts";
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

	constructor(deps: GitServiceDeps) {
		this.#deps = deps;
		this.store = createStore<GitServiceState>(() => ({ byWorkspace: {} }));
	}

	/** Polls a workspace until the returned function is called. Several callers share one timer. */
	watch(_workspaceId: WorkspaceId, _depth: PollDepth): Unsubscribe {
		void this.#deps;
		return notImplemented("GIT-02");
	}

	refresh(_workspaceId: WorkspaceId, _depth: PollDepth): Promise<Result<void>> {
		return notImplemented("GIT-02");
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
