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
 * injected source, because the name list is a separate product decision. Creation ends in `ready`
 * until WS-03 adds the setup run and its copied files; a pull-request or issue base waits for WS-02.
 * Test first: classifyUnarchive returns "branchTaken" when the branch is checked out elsewhere.
 */
import {
	type AppError,
	appError,
	err,
	notImplemented,
	ok,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { Draft, NewWorkspaceInput, UnarchiveOutcome } from "../api.ts";
import type { Repositories } from "../db/repositories.ts";
import { apiUserLogin } from "../git/gh-commands.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	branchNameIsTaken,
	createWorktree,
	nextFreeName,
	prepareWorktree,
} from "../git/worktree.ts";
import type { BacklogWorkspace, KanbanStatus, Session, Workspace } from "../model.ts";
import { allocatePort } from "./ports.ts";

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

/** The branch prefix Conductor's Git setting chooses (ui-map 6): GitHub login, custom text, or none. */
export function branchPrefixFor(type: string, custom: string, githubLogin: string | null): string {
	if (type === "none") return "";
	if (type === "custom") return custom;
	return githubLogin === null || githubLogin === "" ? "" : `${githubLogin}/`;
}

/** Expands a leading `~` in the configured root folder, so no shell is needed to read it. */
export function expandHome(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return `${home}/${path.slice(2)}`;
	return path;
}

/** The folder a workspace's worktree gets: `<root>/workspaces/<repo>/<place>`. */
export function worktreeFolderFor(root: string, repoName: string, place: string): string {
	return `${root.replace(/\/+$/, "")}/workspaces/${repoName}/${place}`;
}

/** Resolves `NewWorkspaceInput.from` to the branch the worktree starts from. */
export function baseBranchFor(
	defaultBranch: string,
	from: NewWorkspaceInput["from"],
): Result<string> {
	if (from.kind === "default") return ok(defaultBranch);
	if (from.kind === "branch") {
		const name = from.name.trim();
		return name === ""
			? err(appError("workspace_base_missing", "Choose the branch to start from."))
			: ok(name);
	}
	return err(
		appError(
			"workspace_base_unsupported",
			"Creating a workspace from a pull request or issue is not built yet.",
		),
	);
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
	/** The first chat's draft, for "Recover prompt" after a failed creation. */
	firstDraftOf(workspaceId: WorkspaceId): Promise<Result<Draft>>;
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

	async start(): Promise<Result<void>> {
		const listed = await this.#deps.repos.workspaces.listAll();
		if (!listed.ok) {
			this.store.setState((state) => ({ ...state, loaded: true }));
			return listed;
		}
		const workspacesById: Record<string, Workspace> = {};
		for (const workspace of listed.value) workspacesById[workspace.id] = workspace;
		this.store.setState((state) => ({ ...state, loaded: true, workspacesById }));
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.create`: row first, then worktree, setup, and the first chat. */
	async create(input: NewWorkspaceInput): Promise<Result<Workspace>> {
		const found = await this.#deps.repos.repos.get(input.repoId);
		if (!found.ok) return found;
		const repo = found.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const target = baseBranchFor(repo.defaultBranch, input.from);
		if (!target.ok) return target;

		const root = expandHome(
			this.#deps.setting<string>("conducted_root_path"),
			this.#deps.platform.fs.paths.home,
		);
		const names = await this.#deps.repos.workspaces.listDirectoryNames(repo.id);
		if (!names.ok) return names;
		const taken = new Set(names.value);
		const picked = this.#deps.placeNames.pick(taken);
		const folder = await nextFreeName(picked, async (candidate) => {
			if (taken.has(candidate)) return true;
			return this.#deps.platform.fs.exists(worktreeFolderFor(root, repo.name, candidate));
		});
		if (!folder.ok) return folder;

		const prefixType = this.#deps.setting<string>("branch_prefix_type");
		const login = prefixType === "github_username" ? await this.#githubLogin(repo.rootPath) : null;
		const prefix = branchPrefixFor(
			prefixType,
			this.#deps.setting<string>("branch_prefix_custom"),
			login,
		);
		const branch = await nextFreeName(`${prefix}${folder.value}`, (candidate) =>
			branchNameIsTaken(this.#deps.git, {
				repoRootPath: repo.rootPath,
				remote: "origin",
				name: candidate,
			}),
		);
		if (!branch.ok) return branch;

		const ports = await this.#deps.repos.workspaces.listPorts();
		if (!ports.ok) return ports;
		const port = allocatePort(new Set(ports.value));
		if (!port.ok) return port;

		const worktreePath = worktreeFolderFor(root, repo.name, folder.value);
		const row = await this.#deps.repos.workspaces.create({
			repoId: repo.id,
			directoryName: folder.value,
			path: worktreePath,
			branch: branch.value,
			branchIsPlaceholder: true,
			targetBranch: target.value,
			port: port.value,
			linkedPaths: [],
			setupLogPath: null,
		});
		if (!row.ok) return row;
		this.#upsert(row.value);

		const created = await createWorktree(this.#deps.git, {
			repoRootPath: repo.rootPath,
			remote: "origin",
			baseBranch: target.value,
			newBranch: branch.value,
			worktreePath,
			allowLocalBase: repo.remoteUrl === null,
		});
		if (!created.ok) return this.#fail(row.value, created.error);

		const prepared = await prepareWorktree(this.#deps.git, {
			repoRootPath: repo.rootPath,
			worktreePath,
			autoSetupUpstream: this.#deps.setting<boolean>("worktree_push_auto_setup_remote"),
			fs: this.#deps.platform.fs,
		});
		if (!prepared.ok) return this.#fail(row.value, prepared.error);

		const moved = await this.#deps.repos.workspaces.transitionState(
			row.value.id,
			"initializing",
			"ready",
		);
		if (!moved.ok) return this.#fail(row.value, moved.error);
		const readyWorkspace: Workspace = { ...row.value, state: "ready", updatedAt: this.#deps.now() };
		this.#upsert(readyWorkspace);

		if (input.prompt.trim() !== "" || input.attachmentPaths.length > 0) {
			const chat = await this.#deps.sessions.createFirstChat(row.value.id, input);
			if (!chat.ok) return chat;
		}
		return ok(readyWorkspace);
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

	async rename(id: WorkspaceId, name: string): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const displayName = name.trim() === "" ? null : name.trim();
		const written = await this.#deps.repos.workspaces.setDisplayName(id, displayName);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, displayName, updatedAt: this.#deps.now() });
		return ok(undefined);
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
	async retrySetup(id: WorkspaceId): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		if (workspace.state !== "failed") return ok(undefined);

		const repoResult = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoResult.ok) return repoResult;
		const repo = repoResult.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const moved = await this.#deps.repos.workspaces.transitionState(id, "failed", "initializing");
		if (!moved.ok) return moved;
		this.#upsert({ ...workspace, state: "initializing", updatedAt: this.#deps.now() });

		const exists = await this.#deps.platform.fs.exists(workspace.path);
		if (!exists) {
			const created = await createWorktree(this.#deps.git, {
				repoRootPath: repo.rootPath,
				remote: "origin",
				baseBranch: workspace.targetBranch,
				newBranch: workspace.branch,
				worktreePath: workspace.path,
				allowLocalBase: repo.remoteUrl === null,
			});
			if (!created.ok) return this.#fail({ ...workspace, state: "initializing" }, created.error);
		}

		const prepared = await prepareWorktree(this.#deps.git, {
			repoRootPath: repo.rootPath,
			worktreePath: workspace.path,
			autoSetupUpstream: this.#deps.setting<boolean>("worktree_push_auto_setup_remote"),
			fs: this.#deps.platform.fs,
		});
		if (!prepared.ok) return this.#fail({ ...workspace, state: "initializing" }, prepared.error);

		const ready = await this.#deps.repos.workspaces.transitionState(id, "initializing", "ready");
		if (!ready.ok) return this.#fail({ ...workspace, state: "initializing" }, ready.error);
		this.#upsert({ ...workspace, state: "ready", updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.recoverPrompt`. */
	async recoverPrompt(id: WorkspaceId): Promise<Result<Draft>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		return this.#deps.sessions.firstDraftOf(id);
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

	/** Puts one workspace in the store, so the sidebar shows it before the git work finishes. */
	#upsert(workspace: Workspace): void {
		this.store.setState((state) => ({
			...state,
			workspacesById: { ...state.workspacesById, [workspace.id]: workspace },
		}));
	}

	/** Moves a half-created workspace to failed and keeps its row (D034). */
	async #fail(workspace: Workspace, error: AppError): Promise<Result<never>> {
		const moved = await this.#deps.repos.workspaces.transitionState(
			workspace.id,
			"initializing",
			"failed",
		);
		if (moved.ok && moved.value) {
			this.#upsert({ ...workspace, state: "failed", updatedAt: this.#deps.now() });
		}
		return err(error);
	}

	/** The GitHub login used by the default branch prefix. Null when `gh` is not signed in. */
	async #githubLogin(repoRootPath: string): Promise<string | null> {
		const result = await this.#deps.git.run(apiUserLogin(), { cwd: repoRootPath });
		if (!result.ok || result.value.exitCode !== 0) return null;
		const login = result.value.stdout.trim();
		return login === "" ? null : login;
	}
}
