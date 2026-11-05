/**
 * @feature WS-01 Workspace service: create, set up, archive, unarchive, delete
 * Owns: the list of workspaces and their lifecycle: creating a worktree and its first chat,
 * running the setup script, renaming the placeholder branch, archiving, restoring and deleting.
 * Behaviour: frontend.md 6 (creation, naming, setup, archive), services-map.md 2.4.1 (state
 * machine), 3.1 (create), 3.2 and 5A.1.2 (setup), 3.10 (archive and unarchive), 3.11 (branch
 * rename), ui-map.md 3.9 and 3.1.
 * Must handle: state moves initializing -> ready (or failed), ready -> archiving -> archived, and
 * archived -> initializing -> ready on unarchive, each guarded so a stale step cannot move a
 * workspace that already changed; the directory name is a unique place name for the repo and the
 * branch is prefix + name, suffixed -v1, -v2 when taken; creation fetches the base, falls back to
 * the cached remote ref offline and tells the user; copying the repo's files (for example
 * `.env`) is part of creation; setup runs in a terminal with the workspace variables and its
 * result decides ready or failed (a failed setup keeps the workspace, with a retry); archiving
 * refuses while a chat is working (offers cancel), takes a checkpoint, pins HEAD under the
 * archive ref, runs the archive script, removes the worktree, optionally deletes the branch (never
 * the default branch); unarchive classifies the old branch (deleted, taken, diverged, fine) and
 * picks a branch name, then restores the saved state; delete removes the worktree folder to the
 * Trash and the rows; the auto rename of the placeholder branch happens once, after the first
 * message, and never when the user named the branch; `markRead` clears unread on all chats of the
 * workspace.
 * Our design choice: creation is split in two so the sidebar shows the workspace at once
 * (`initializing`) and the slow git work happens after the row exists. Place names come from an
 * injected source, because the name list is a separate product decision.
 * Test first: classifyUnarchive returns "branchTaken" when the branch is checked out elsewhere.
 */
import {
	appError,
	err,
	notImplemented,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { Draft, NewWorkspaceInput, UnarchiveOutcome } from "../api.ts";
import type { Repositories } from "../db/repositories.ts";
import type { GitRunner } from "../git/runner.ts";
import type { BacklogWorkspace, KanbanStatus, Session, Workspace } from "../model.ts";

export interface PlaceNames {
	/** A place name that is not in `taken`. */
	pick(taken: ReadonlySet<string>): string;
}

export type UnarchiveCase = "happy" | "branchDeleted" | "branchTaken" | "branchDiverged";

/** Decides how to restore an archived workspace (services-map.md 3.10). First match wins. */
export function classifyUnarchive(facts: {
	branchExists: boolean;
	checkedOutElsewhere: boolean;
	branchTip: string | null;
	archiveCommit: string | null;
}): UnarchiveCase {
	if (!facts.branchExists) return "branchDeleted";
	if (facts.checkedOutElsewhere) return "branchTaken";
	if (facts.archiveCommit !== null && facts.branchTip !== facts.archiveCommit)
		return "branchDiverged";
	return "happy";
}

export type SetupState = "idle" | "running" | "completed" | "failed" | "cancelled";

export interface WorkspaceState {
	loaded: boolean;
	workspacesById: Readonly<Record<string, Workspace>>;
	/** In memory only: the setup script's state per workspace. */
	setup: Readonly<Record<string, SetupState>>;
	/** Workspaces whose archive is running. */
	archiving: Readonly<Record<string, boolean>>;
}

/** What the workspace service needs from chats. The sessions service satisfies it. */
export interface WorkspaceSessionsPort {
	createFirstChat(workspaceId: WorkspaceId, input: NewWorkspaceInput): Promise<Result<Session>>;
	cancelAll(workspaceId: WorkspaceId): Promise<Result<void>>;
	hasWorkingChats(workspaceId: WorkspaceId): boolean;
	markAllRead(workspaceId: WorkspaceId): Promise<Result<void>>;
	deleteAll(workspaceId: WorkspaceId): Promise<Result<void>>;
}

export interface WorkspaceServiceDeps {
	platform: Pick<Platform, "fs" | "opener">;
	git: GitRunner;
	repos: Pick<Repositories, "repos" | "workspaces" | "sessions">;
	placeNames: PlaceNames;
	sessions: WorkspaceSessionsPort;
	/** Allocates a port block, runs scripts, stops runs, takes checkpoints. */
	ports: { allocateForNewWorkspace(): Promise<Result<number>> };
	scripts: {
		runSetup(workspaceId: WorkspaceId): Promise<Result<{ exitCode: number | null }>>;
		runArchive(workspaceId: WorkspaceId): Promise<Result<void>>;
		stopWorkspace(workspaceId: WorkspaceId): Promise<Result<void>>;
	};
	setting: <T>(key: string) => T;
	now: () => number;
}

export class WorkspaceService {
	readonly store: StoreApi<WorkspaceState>;
	readonly #deps: WorkspaceServiceDeps;

	constructor(deps: WorkspaceServiceDeps) {
		this.#deps = deps;
		this.store = createStore<WorkspaceState>(() => ({
			loaded: false,
			workspacesById: {},
			setup: {},
			archiving: {},
		}));
	}

	start(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("WS-01");
	}

	/** Backs `Actions.workspaces.create`: row first, then worktree, setup, and the first chat. */
	create(_input: NewWorkspaceInput): Promise<Result<Workspace>> {
		return notImplemented("WS-01");
	}

	/** Resolves `NewWorkspaceInput.from` (default, branch, pull request, issue) to a base commit. */
	resolveBase(
		_repoId: RepoId,
		_from: NewWorkspaceInput["from"],
	): Promise<Result<{ baseSha: string; branchName: string | null }>> {
		return notImplemented("WS-02");
	}

	/** Runs the repo's setup script in a terminal and moves the workspace to ready or failed. */
	runSetup(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("WS-03");
	}

	cancelSetup(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("WS-03");
	}

	/** Renames the placeholder branch once the first message tells what the work is. */
	renameBranchAfterFirstMessage(_sessionId: SessionId): Promise<Result<void>> {
		return notImplemented("WS-04");
	}

	/** Backs `Actions.workspaces.archive`. */
	archive(_id: WorkspaceId, _options: { deleteBranch: boolean }): Promise<Result<void>> {
		return notImplemented("WS-05");
	}

	/** Backs `Actions.workspaces.unarchive`. */
	unarchive(
		_id: WorkspaceId,
		_options: { branchName: string | null; clearChats: boolean },
	): Promise<Result<UnarchiveOutcome>> {
		return notImplemented("WS-06");
	}

	/** Backs `Actions.workspaces.setLinkedPaths`: extra folders agents may read and edit. */
	setLinkedPaths(_id: WorkspaceId, _paths: readonly string[]): Promise<Result<void>> {
		return notImplemented("WS-07");
	}

	/** Backs `Actions.workspaces.remove`. */
	remove(_id: WorkspaceId): Promise<Result<void>> {
		return notImplemented("WS-10");
	}

	/** Removes every workspace of a repository. Used when the repository is removed. */
	removeWorkspacesOf(_repoId: RepoId): Promise<Result<void>> {
		return notImplemented("WS-10");
	}

	/** Called by the GitHub service when a PR merges; archives when the repo setting asks for it. */
	onPullRequestMerged(_id: WorkspaceId, _prNumber: number): Promise<Result<void>> {
		return notImplemented("WS-05");
	}

	rename(_id: WorkspaceId, _name: string): Promise<Result<void>> {
		return notImplemented("WS-01");
	}

	setPinned(_id: WorkspaceId, _pinned: boolean): Promise<Result<void>> {
		return notImplemented("NAV-04");
	}

	setKanbanStatus(_id: WorkspaceId, _status: KanbanStatus): Promise<Result<void>> {
		return notImplemented("NAV-06");
	}

	markRead(_id: WorkspaceId): Promise<Result<void>> {
		return notImplemented("NAV-11");
	}

	/** Backs `Actions.workspaces.openIn`: opens the workspace folder in another app. */
	async openIn(id: WorkspaceId, appName: string): Promise<Result<void>> {
		const workspace = this.store.getState().workspacesById[id];
		if (workspace === undefined)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		return this.#deps.platform.opener.openWith(appName, workspace.path);
	}

	/** Backs `Actions.workspaces.setActiveSession`. */
	setActiveSession(_id: WorkspaceId, _sessionId: SessionId): Promise<Result<void>> {
		return notImplemented("NAV-02");
	}

	/** Backs `Actions.workspaces.retrySetup`. A second call while setup runs is ignored. */
	retrySetup(_id: WorkspaceId): Promise<Result<void>> {
		return notImplemented("WS-01");
	}

	/** Backs `Actions.workspaces.recoverPrompt`. */
	recoverPrompt(_id: WorkspaceId): Promise<Result<Draft>> {
		return notImplemented("WS-01");
	}

	/** Backs `Actions.workspaces.addToBacklog`. */
	addToBacklog(_input: NewWorkspaceInput): Promise<Result<BacklogWorkspace>> {
		return notImplemented("WS-11");
	}

	/** Backs `Actions.workspaces.startFromBacklog`: the normal create flow, keeping the id. */
	startFromBacklog(_id: WorkspaceId): Promise<Result<Workspace>> {
		return notImplemented("WS-11");
	}

	/** Backs `Actions.workspaces.removeFromBacklog`. */
	removeFromBacklog(_id: WorkspaceId): Promise<Result<void>> {
		return notImplemented("WS-11");
	}
}
