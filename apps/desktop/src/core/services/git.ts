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
 * Test first: stateOf merges the polled snapshot with PR info from the GitHub service.
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "../../platform/platform.ts";
import type { ChangedFile, DiffScope } from "../api.ts";
import type { GitRunner } from "../git/runner.ts";
import type { ChangesSnapshot } from "../git/status.ts";
import type { GitState } from "../model.ts";
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

export interface GitServiceDeps {
	git: GitRunner;
	/** Looks up folders and branch names for a workspace. Fails for unknown ids. */
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
	agent: AgentMessenger;
	now: () => number;
}

export class GitService {
	readonly store: StoreApi<GitServiceState>;
	readonly #deps: GitServiceDeps;

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
}
