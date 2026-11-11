/**
 * @feature WS-01 Workspace service: create, set up, archive, unarchive, delete; WS-10 Delete a
 * workspace
 * @feature WS-02 Create from a branch, PR or issue
 * @feature CHAT-21 Fork a chat to a new workspace
 * @feature WS-04 Rename the placeholder branch after the first message
 * @feature WS-07 Linked workspaces and extra folders
 * @feature WS-11 Backlog workspaces: save now, start later
 * @feature PR-10 Link a pull request by URL or number: storing the linked pull request on the
 * workspace.
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the list of workspaces and their lifecycle as far as it is built: running the setup
 * script, archiving a workspace, unarchiving one, deleting one or all of a
 * repository's workspaces, storing the intended target branch (GIT-08), saving a renamed branch
 * (GIT-09), renaming the placeholder branch from a suggested name after the first message, saving
 * a workspace's linked folders (WS-07), and saving, starting and removing backlog workspaces
 * (WS-11), and storing a linked pull request (PR-10). It delegates creation (`create`,
 * `createFirst`, `createFromCommit` and `resolveBase`) to `WorkspaceCreation` in
 * `workspace-creation.ts` (D125).
 * Behaviour: frontend.md 6 (creation, naming, setup, archive), services-map.md 2.3.1 (workspace
 * delete), 2.4.1 (state machine), 3.1 (create), 3.2 and 5A.1.2 (setup), 3.10 (archive, unarchive
 * and delete), 3.11 (branch rename, the first-message rename and the stored target branch),
 * 3.16 (archive refs), ui-map.md 3.9, 3.1 and 6 Git.
 * Must handle: state moves initializing -> ready (or failed), each guarded so a stale step cannot
 * move a workspace that already changed; the directory name is a unique place name for the repo
 * and the branch is prefix + name, suffixed -v1, -v2 when taken; a branch, prefix or remote name
 * that git could read as an option or refuses is rejected before any git call; creation fetches
 * the base, falls back to the cached remote ref offline and tells the user; copying the repo's
 * files (for example `.env`) is part of creation and never overwrites a file already in the
 * worktree; setup runs in a terminal with the workspace variables and its result decides ready or
 * failed (a failed setup keeps the workspace, with a retry; a second retry while one runs is
 * ignored); creations run one at a time; a repository config that cannot be read for the remote
 * name stops creation with its error, while a failed read of the file list or the default config
 * is shown as a warning; the file commands reach a folder outside `~/conducted` only once it is
 * registered (PLAT-02), so a start registers the workspaces folder and every saved workspace's
 * folder, and a create or unarchive registers the workspaces folder before it looks in it; a start
 * that cannot read the table keeps its error in `loadError`, so the sidebar shows the failure
 * instead of an empty list (DATA-01).
 * Built now (WS-04): the first-message rename runs only when `auto_rename_new_branches` is on and
 * the workspace still has its placeholder branch. It is skipped when a pull request is linked,
 * the branch has already changed (in the row or in git), the suggestion is empty or failed, or
 * no suggester is wired. The suggestion is combined with the branch prefix, a name clash takes
 * the next `-vN` suffix, and `auto_rename_workspace_on_branch_name_set` renames the workspace to
 * the new branch name unless the user set a name.
 * Built now (WS-10): delete a workspace by id and every workspace of a repository. It cancels the
 * workspace's chats, stops its processes, removes its worktree and archive ref, moves its setup log,
 * viewed-files file, Cursor run store and git cache files (DATA-07) to the Trash, deletes its chats with their
 * attachment files, then deletes the row and forgets it in the store. A repository removal stops
 * every workspace's processes first.
 * Built now (WS-05): archive. It refuses while a chat is running unless the caller has asked to
 * stop the agents (`stopRunningAgents`), refuses a folder that is missing as `workspace_corrupted`,
 * stops a setup or run process
 * that is still running and clears the workspace's run state, cancels the remaining chats, saves
 * the archive snapshot, reads the branch git reports (a detached HEAD or a failed read stops the
 * archive), pins HEAD under the archive ref, runs the archive script, removes the worktree,
 * optionally deletes the branch (never the default branch; a failed delete is recorded as a
 * warning because the archive already finished), and records the archive commit and time.
 * Archive-on-merge is refused for a corrupted workspace and ignores a merged PR that is not the
 * workspace's own. The open-PR check and the write-access refusal are not built (they exist only
 * for cloud workspaces, which have no linked-PR rows here); the stack rule is decided by the
 * GitHub poll before this call. The service refuses a busy checkout and accepts
 * `discardGitOperationState` from a caller that has already asked.
 * Built now (WS-06): unarchive. It classifies the branch as gone, taken, moved or fine, re-adds
 * the worktree (creating a missing branch from the archive commit), restores the archive
 * checkpoint, and sets the branch, folder, path and ready state while clearing the archive time
 * and moving the workspace's recent activity to the restore time (services-map.md 3.10). A
 * complete restore then runs the setup script again, as Conductor does, and a setup failure is
 * left to the Setup tab rather than failing the unarchive.
 * A branch open in another worktree or moved since the archive returns `needsBranchName` and
 * changes nothing. A checkpoint restore that fails only sets `uncommittedChangesLost`. A worktree
 * that cannot be restored is rolled back: the re-added folder and a branch the call created are
 * removed and the state goes back to archived. A rollback step that fails is named in the
 * returned error, and a workspace that cannot go back to archived stays initializing in the store.
 * Built now (WS-07): linked paths. An absolute folder path is stored for each linked workspace or
 * extra folder, duplicates and empty entries are dropped, the loaded row keeps the new list, and
 * every existing chat stores the folders so its next message carries them.
 * Built now (WS-11): a backlog workspace keeps its repository, first message, attachments, chat
 * config and section without a worktree or branch. Starting one runs the normal creation flow and
 * removes the saved entry; removing one deletes only the entry. Removing its repository keeps the
 * entry with no repository, and starting it then returns the message the create flow shows until
 * the user picks another (`setBacklogRepo`).
 * Built now (NAV-06): the Kanban status. It stores the user-set status and keeps the loaded row in
 * step, returning `workspace_unknown` when the workspace is gone.
 * Our design choice: creation is split in two so the sidebar shows the workspace at once
 * (`initializing`) and the slow git work happens after the row exists (D125; the create path now
 * lives in `workspace-creation.ts`). Place names come from our own tiered source there
 * (`createPlaceNames`, D002), drawn from the gazetteer the Passport map reads
 * (core/place-gazetteer.ts), and the composition root passes it. Creation copies the repository's
 * included files, counts the worktree files, then runs setup in a terminal. Warnings and the first
 * message of a failed creation live in this service's in-memory store: the contract's `Workspace`
 * row has no field for them, and the create page reads them back after the action returns. The
 * composition root supplies the repository config reader; the default-config reader remains
 * optional until the composition root passes it.
 * CLOUD-01: setup, the first-message branch rename, archive, unarchive, delete and Open in check
 * the workspace's host before they touch its folder (core/host.ts). Creating a workspace makes a
 * worktree on this Mac and stores the local host, unless the page names the paired Worker.
 * CLOUD-19: a create that names a Worker (`cloudUrl`) runs the same path with a cloud host: the
 * row gets its own sandbox name and the folder `/workspace/<name>` in it, then the sandbox is
 * started, the project's GitHub repository is cloned into that folder and the new branch is
 * checked out from `origin/<base>` (a pull request's head is fetched first). The worktree config,
 * the copy of the Mac's included files and the Mac's base fetch do not apply in a sandbox; the
 * file count, setup, section and first chat are shared. A project with no GitHub remote is refused
 * before the Worker is asked anything, because the Worker clones from GitHub only (D104). D127.
 * CLOUD-10: archive and delete stop the workspace's port forwards first, since its sandbox sleeps
 * (D110). Every path that archives or deletes one does this: the menu, archive-on-merge and a
 * repository removal.
 * CLOUD-12: Open in on a cloud workspace runs VS Code, Cursor or Zed over its SSH door, and
 * `copySshCommand` returns Conductor's `ssh <name>.conducted`. Both live in `core/cloud/ssh.ts`.
 * Test first: classifyUnarchive returns "branchTaken" when the branch is checked out elsewhere;
 * WS-04 renames a placeholder branch to a suggestion that clashes, with the `-v2` suffix;
 * unarchive re-adds the worktree on the same branch, restores the archive checkpoint, and clears
 * the archive time; a branch checked out elsewhere asks for a new name.
 */
import type { SessionConfig } from "@conducted/protocol";
import {
	type AppError,
	appError,
	err,
	type IdSource,
	ok,
	type RepoId,
	type Result,
	type SessionId,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Cloud, Platform } from "../../platform/platform.ts";
import type { Draft, NewWorkspaceInput, UnarchiveOutcome } from "../api.ts";
import { cursorStoreFolder, setupLogFile, viewedFilesFile } from "../app-paths.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import {
	removeCloudWorkspace,
	restartCloudWorkspace,
	stopCloudWorkspace,
} from "../cloud/lifecycle.ts";
import { ensureSshSession, openRemoteWorkspace, type SshDeps, sshCommand } from "../cloud/ssh.ts";
import type { ArchivingWorkspace } from "../db/repair.ts";
import type { Repositories } from "../db/repositories.ts";
import { trashIfPresent } from "../fs-helpers.ts";
import {
	branchDeleteForce,
	branchShowCurrent,
	diffQuietHead,
	diffToolKsdiff,
	revParseHead,
	updateRefDelete,
} from "../git/commands.ts";
import { archiveRef } from "../git/refs.ts";
import { renameBranchInWorktree } from "../git/rename.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	addWorktreeOnBranch,
	nextFreeName,
	pinArchiveHead,
	readBranchState,
	removeWorktree,
	restoreArchiveCheckpoint,
	saveArchiveSnapshot,
} from "../git/worktree.ts";
import { checkHost } from "../host.ts";
import type {
	BacklogWorkspace,
	KanbanStatus,
	PullRequestSummary,
	RepoConfig,
	Session,
	Workspace,
} from "../model.ts";
import { isArchivedWorkspace } from "../status/archived.ts";
import {
	invalidRefNameError,
	isSafeRefName,
	NO_READY_REPOSITORY_MESSAGE,
	normaliseLinkedPaths,
	SETUP_FAILED_MESSAGE,
	SETUP_LOG_MISSING_MESSAGE,
} from "../workspace-helpers.ts";
import type { GitCache } from "./git-cache.ts";
import type { SetupRunResult } from "./run-scripts.ts";
import { type PlaceNames, WorkspaceCreation, worktreeFolderFor } from "./workspace-creation.ts";

export type { PlaceNames } from "./workspace-creation.ts";
export {
	baseBranchFor,
	CHAT_CREATION_FAILED_MESSAGE,
	CLOUD_REPO_NOT_GITHUB_MESSAGE,
	COPY_FILE_SIZE_LIMIT,
	type CopyIncludedFilesDeps,
	copyIncludedFiles,
	createPlaceNames,
	DEFAULT_COPY_FILES,
	FIRST_CHAT_APP_TOOLS,
	GITHUB_LOGIN_MISSING_MESSAGE,
	matchesCopyPattern,
	type NewWorkspaceSessionDefaults,
	newWorkspaceConfigFromSettings,
	newWorkspaceSessionConfig,
	parseWorktreeInclude,
	SECTION_PLACEMENT_FAILED_MESSAGE,
	selectIncludedPaths,
	worktreeFolderFor,
} from "./workspace-creation.ts";

/** The Open in app that shows a workspace's changes as a diff instead of its folder. */
const KALEIDOSCOPE_APP = "Kaleidoscope";

/** Shown when the branch a caller asked to restore is already open in another worktree. */
export const BRANCH_CHECKED_OUT_MESSAGE =
	"That branch is checked out elsewhere. Choose another branch name.";

/** Shown when an archived workspace has no commit to recreate its missing branch from. */
export const ARCHIVE_COMMIT_MISSING_MESSAGE =
	"This workspace has no saved commit, so its missing branch cannot be restored.";

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

/** Expands a leading `~` in the configured root folder, so no shell is needed to read it. */
export function expandHome(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return `${home}/${path.slice(2)}`;
	return path;
}

export type SetupState =
	| "idle"
	| "detecting"
	| "running"
	| "stopping"
	| "completed"
	| "failed"
	| "cancelled";

/** Shown when the app was quit or crashed while setup was running (services-map.md 2.4.6). */
export const SETUP_INTERRUPTED_MESSAGE =
	"The app quit while setup was running. Run setup again to finish it.";

/** Shown when archive is asked for while a chat is still running (inventory:toast). */
export const ARCHIVE_RUNNING_CHATS_MESSAGE =
	"Stop the running chats before archiving this workspace.";

/** Shown when a workspace that is still being created is asked to archive. */
export const ARCHIVE_NOT_READY_MESSAGE = "This workspace is still being created.";

/** Shown when the worktree is not on a branch, so archive cannot record which branch it keeps. */
export const ARCHIVE_DETACHED_HEAD_MESSAGE =
	"Git is not on a branch in this workspace. Check out its branch, then archive it again.";

/** Shown when archive-on-merge finds a ready workspace whose folder is gone (services-map 5B.1.9). */
export const WORKSPACE_CORRUPTED_MESSAGE =
	"This workspace's folder is missing, so it can't be archived. Check the folder or remove the workspace.";

/** One setup run, kept in memory for the Setup tab while the app is open. */
export interface SetupRun {
	state: SetupState;
	exitCode: number | null;
	terminalId: SetupRunResult["terminalId"];
	logPath: string | null;
	log: SetupRunResult["log"];
	interruptedReason: string | null;
}

export interface WorkspaceState {
	loaded: boolean;
	/**
	 * The error that stopped the workspace table from loading. A failed start keeps no rows, so without
	 * this the sidebar would show "No workspaces yet" for a database failure (DATA-01). A retry clears
	 * it.
	 */
	loadError: AppError | null;
	/** Workspaces saved to the backlog, not started yet (WS-11). */
	backlogLoaded: boolean;
	backlogById: Readonly<Record<string, BacklogWorkspace>>;
	workspacesById: Readonly<Record<string, Workspace>>;
	/** In memory only: the setup script's state per workspace. */
	setup: Readonly<Record<string, SetupState>>;
	/** In memory only: the last setup run of each workspace, for the Setup tab. */
	setupRuns?: Readonly<Record<string, SetupRun>>;
	/** Workspaces whose archive is running. */
	archiving: Readonly<Record<string, boolean>>;
	/** In memory only: a side step that failed after a workspace was archived, for its screen to show. */
	archiveWarnings?: Readonly<Record<string, string>>;
	/** In memory only: warnings from a workspace's creation, for the create page to toast. */
	warnings?: Readonly<Record<string, readonly string[]>>;
	/** In memory only: the first-message input of a creation that failed, for Recover and Retry. */
	failedFirstInputs?: Readonly<Record<string, NewWorkspaceInput>>;
	/** In memory only: the workspace row of the last creation that failed, for the create page. */
	lastFailedCreate?: Workspace | null;
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

/** The model call that proposes a branch name (SIDE-24). The container passes ChatTitleService. */
export interface BranchNameSuggester {
	suggestBranchName(input: {
		session: Session;
		workspace: Workspace;
		firstUserMessage: string;
		/** The repository's Rename branch prompt, added to the built-in text. */
		customPrompt: string | null;
	}): Promise<Result<string | null>>;
}

export interface WorkspaceServiceDeps {
	platform: Pick<Platform, "fs" | "opener" | "shell" | "portForward">;
	/** The Worker door a cloud workspace's creation, archive and delete use (CLOUD-08, CLOUD-19). */
	cloud?: Cloud;
	/** Names a new cloud workspace's sandbox (CLOUD-19). The composition root passes its ids. */
	ids?: IdSource;
	/**
	 * The restart cache of each workspace's changes and pull request info (DATA-07). Deleting a
	 * workspace removes its entries. The composition root supplies it.
	 */
	gitCache?: Pick<GitCache, "remove">;
	git: GitRunner;
	repos: Pick<Repositories, "repos" | "workspaces" | "sessions" | "sections" | "backlogWorkspaces">;
	placeNames: PlaceNames;
	sessions: WorkspaceSessionsPort;
	/**
	 * RUN-03's port service. Creation asks it for the workspace's block, so the stored ports and
	 * the ports already listening on this Mac are both respected.
	 */
	ports?: { allocateForNewWorkspace(): Promise<Result<number>> };
	/**
	 * CLOUD-10: stops a workspace's port forwards before it is archived or deleted. The
	 * composition root passes PortForwardsService.
	 */
	portForwards?: { pauseWorkspace(workspaceId: WorkspaceId): Promise<Result<void>> };
	/**
	 * CLOUD-15: re-reads a cloud workspace's status after a successful restart, so the header does
	 * not wait for its next poll. The composition root passes CloudWorkspaceService.
	 */
	cloudState?: { refresh(workspaceId: WorkspaceId): Promise<Result<unknown>> };
	/** The repository's effective config, for the remote name. Supplied by the composition root. */
	repoConfig: (repoId: RepoId) => Promise<Result<RepoConfig>>;
	/** Reads a pull request's head from GitHub, for a workspace created from a PR (WS-02). */
	github?: {
		pullRequestByNumber(remoteUrl: string, number: number): Promise<Result<PullRequestSummary>>;
	};
	/** WS-04's branch-name call. The composition root passes ChatTitleService. */
	branchNames?: BranchNameSuggester;
	/** The one default-config rule for a new chat. Supplied by the composition root. */
	defaultConfig?: (workspaceId: WorkspaceId) => Promise<Result<SessionConfig>>;
	scripts: {
		runSetup(
			workspaceId: WorkspaceId,
			onStarted?: (terminalId: TerminalId) => void,
		): Promise<Result<SetupRunResult>>;
		runArchive(workspaceId: WorkspaceId): Promise<Result<void>>;
		stopWorkspace(workspaceId: WorkspaceId): Promise<Result<void>>;
		/** Stops every workspace of a repository, used before the repository is removed. */
		stopAllForRepository(workspaceIds: readonly WorkspaceId[]): Promise<Result<void>>;
		/** Forgets a workspace's run state after its processes are stopped. */
		clearRuns(workspaceId: WorkspaceId): void;
	};
	/** Path to the shipped checkpointer script, used for the archive snapshot (WS-05). */
	checkpointerPath: string;
	setting: <T>(key: string) => T;
	now: () => number;
}

export class WorkspaceService {
	readonly store: StoreApi<WorkspaceState>;
	readonly #deps: WorkspaceServiceDeps;
	/** Workspace creation (D125): the row, folder, branch and first chat (CLOUD-19 too). */
	readonly #creation: WorkspaceCreation;

	/** A second archive of one workspace joins the first, so its steps never run twice at once. */
	readonly #archives = createSingleFlight<string>();
	/** A second delete of one workspace joins the first, so its files are not trashed twice. */
	readonly #removals = createSingleFlight<string>();
	/** Bumped by every start and cancel, so an older run cannot change the state after them. */
	readonly #setupNonces = new Map<WorkspaceId, number>();
	/** The nonce of a start that has not reached its first await yet, so a second one is ignored. */
	readonly #setupStarting = new Map<WorkspaceId, number>();
	/** A commit resolved for a workspace before its row existed, so Retry setup reuses it. */
	readonly #baseShas = new Map<WorkspaceId, string>();
	/**
	 * Where a cloud workspace's branch starts in its sandbox, and the ref to fetch first, kept until
	 * its checkout is made so Retry setup reuses it (CLOUD-19).
	 */
	readonly #cloudStarts = new Map<WorkspaceId, { fetch: string | null; startPoint: string }>();

	constructor(deps: WorkspaceServiceDeps) {
		this.#deps = deps;
		this.store = createStore<WorkspaceState>(() => ({
			loaded: false,
			loadError: null,
			backlogLoaded: false,
			backlogById: {},
			workspacesById: {},
			setup: {},
			setupRuns: {},
			archiving: {},
			archiveWarnings: {},
			warnings: {},
			failedFirstInputs: {},
			lastFailedCreate: null,
		}));
		this.#creation = new WorkspaceCreation(deps, {
			store: this.store,
			baseShas: this.#baseShas,
			cloudStarts: this.#cloudStarts,
			put: (workspace) => this.#upsert(workspace),
			worktreesRoot: () => this.#worktreesRoot(),
			registerFolders: (folders) => this.#registerFolders(folders),
			runSetup: (workspaceId) => this.runSetup(workspaceId),
			setActiveSession: (workspaceId, sessionId) => this.setActiveSession(workspaceId, sessionId),
		});
	}

	async start(): Promise<Result<void>> {
		const listed = await this.#deps.repos.workspaces.listAll();
		if (!listed.ok) {
			this.store.setState((state) => ({ ...state, loaded: true, loadError: listed.error }));
			return listed;
		}
		// The file commands reach a workspace folder only once it is registered, on every start.
		// A workspace made before the workspaces folder setting changed lives under the old one.
		// A cloud workspace's folder is not on this Mac, so only local rows are registered; the
		// merged list still fills the store below (CLOUD-13).
		const local = listed.value.filter((workspace) => workspace.host.kind === "local");
		const reachable = await this.#registerFolders([
			this.#worktreesRoot(),
			...local.map((workspace) => workspace.path),
		]);
		if (!reachable.ok) {
			this.store.setState((state) => ({ ...state, loaded: true, loadError: reachable.error }));
			return reachable;
		}
		const workspacesById: Record<string, Workspace> = {};
		const setupRuns: Record<string, SetupRun> = {};
		let logError: AppError | null = null;
		for (const workspace of listed.value) {
			workspacesById[workspace.id] = workspace;
			if (workspace.host.kind !== "local") continue;
			if (workspace.state !== "failed" && workspace.state !== "ready") continue;
			const logPath = await this.#deps.repos.workspaces.getSetupLogPath(workspace.id);
			if (!logPath.ok) {
				// The workspace still loads; the caller hears that its setup log could not be found.
				logError ??= logPath.error;
				continue;
			}
			if (logPath.value === null) continue;
			const saved = await this.#deps.platform.fs.exists(logPath.value);
			// The exit code and the interrupted reason are not stored, so the load leaves both
			// null rather than inventing a value from the workspace state.
			setupRuns[workspace.id] = {
				state: workspace.state === "ready" ? "completed" : "failed",
				exitCode: null,
				terminalId: null,
				logPath: logPath.value,
				log: saved ? "saved" : "missing",
				interruptedReason: null,
			};
		}
		const backlog = await this.#deps.repos.backlogWorkspaces.list();
		if (!backlog.ok) {
			this.store.setState((state) => ({
				...state,
				loaded: true,
				loadError: backlog.error,
				backlogLoaded: true,
			}));
			return backlog;
		}
		const backlogById: Record<string, BacklogWorkspace> = {};
		for (const entry of backlog.value) backlogById[entry.id] = entry;
		this.store.setState((state) => ({
			...state,
			loaded: true,
			loadError: null,
			backlogLoaded: true,
			backlogById,
			workspacesById,
			setupRuns,
		}));
		return logError === null ? ok(undefined) : err(logError);
	}

	/** The folder new worktrees go to: the `conductor_root_path` setting, with `~` expanded. */
	#worktreesRoot(): string {
		return expandHome(
			this.#deps.setting<string>("conductor_root_path"),
			this.#deps.platform.fs.paths.home,
		);
	}

	/** Lets the file commands reach each folder (PLAT-02). Stops at the first refusal. */
	async #registerFolders(folders: readonly string[]): Promise<Result<void>> {
		for (const folder of folders) {
			const registered = await this.#deps.platform.fs.registerRoot(folder);
			if (!registered.ok) return registered;
		}
		return ok(undefined);
	}

	/**
	 * Backs `Actions.workspaces.createFirst`: a just-added project's first workspace, from the
	 * default branch with the user's default chat settings and no first message, as Conductor's
	 * repo-created step makes it (renderApp @1713146, autoCreateWorkspace).
	 */
	createFirst(repoId: RepoId): Promise<Result<Workspace>> {
		return this.#creation.createFirst(repoId);
	}

	/** Backs `Actions.workspaces.create`: row first, then worktree, setup, and the first chat. */
	create(input: NewWorkspaceInput): Promise<Result<Workspace>> {
		return this.#creation.create(input);
	}

	/**
	 * Backs CHAT-21: creates a workspace whose branch starts at an already resolved commit, such as
	 * a turn checkpoint's original HEAD. The rest of the create path is unchanged.
	 */
	createFromCommit(input: NewWorkspaceInput, baseSha: string): Promise<Result<Workspace>> {
		return this.#creation.createFromCommit(input, baseSha);
	}

	/** Backs WS-02: resolves a default branch, branch, pull request or issue to its base commit. */
	async resolveBase(
		repoId: RepoId,
		from: NewWorkspaceInput["from"],
	): Promise<Result<{ baseSha: string; branchName: string; warning: string | null }>> {
		return this.#creation.resolveBase(repoId, from);
	}

	/**
	 * Runs the repo's setup script in a terminal and moves the workspace to ready or failed. An
	 * unarchive that reruns setup keeps the restored workspace ready when the script fails, as
	 * Conductor does; the Setup tab carries the failure.
	 */
	async runSetup(
		workspaceId: WorkspaceId,
		options: { keepStateOnFailure?: boolean } = {},
	): Promise<Result<void>> {
		// Register the start and its nonce before the first await. A second start or a cancel in
		// the same tick then sees this run instead of slipping past a check that waits on the row.
		if (this.#setupStarting.has(workspaceId)) return ok(undefined);
		const current = this.store.getState().setup[workspaceId];
		if (current === "running") return ok(undefined);

		const nonce = (this.#setupNonces.get(workspaceId) ?? 0) + 1;
		this.#setupNonces.set(workspaceId, nonce);
		this.#setupStarting.set(workspaceId, nonce);

		try {
			const found = await this.#deps.repos.workspaces.get(workspaceId);
			if (this.#setupNonces.get(workspaceId) !== nonce) return ok(undefined);
			if (!found.ok) return found;
			const workspace = found.value;
			if (workspace === null) {
				return err(appError("workspace_unknown", "That workspace no longer exists."));
			}
			checkHost(workspace.host, "shell");
			if (isArchivedWorkspace(workspace) || workspace.state === "archiving") {
				return err(appError("workspace_not_ready", "That workspace is archived."));
			}

			// Record the log path before the script starts, so a quit during setup leaves a row
			// that the next start can still show a log for.
			const logPath = setupLogFile(this.#deps.platform.fs.paths, workspaceId);
			const recorded = await this.#deps.repos.workspaces.setSetupLogPath(workspaceId, logPath);
			if (!recorded.ok) return recorded;
			this.#setSetupRun(workspaceId, {
				state: "detecting",
				exitCode: null,
				terminalId: null,
				logPath,
				log: "live",
				interruptedReason: null,
			});

			const result = await this.#deps.scripts.runSetup(workspaceId, (terminalId) => {
				if (this.#setupNonces.get(workspaceId) !== nonce) return;
				this.#setSetupRun(workspaceId, { state: "running", terminalId });
			});
			if (this.#setupNonces.get(workspaceId) !== nonce) return ok(undefined);

			if (!result.ok) {
				this.#setSetupRun(workspaceId, { state: "failed", exitCode: null, log: "missing" });
				if (options.keepStateOnFailure === true) return err(result.error);
				const moved = await this.#finishSetup(workspaceId, false);
				return moved.ok ? err(result.error) : moved;
			}

			const run = result.value;
			const exitCode = run.exitCode;
			// A null exit code means the process was killed or its end is unknown. Only a real
			// exit code of 0, or no script to run, counts as success.
			const succeeded = run.scriptFound ? exitCode === 0 : true;
			if (!run.scriptFound) {
				const cleared = await this.#deps.repos.workspaces.setSetupLogPath(workspaceId, null);
				if (!cleared.ok) return cleared;
			}
			this.#setSetupRun(workspaceId, {
				state: succeeded ? "completed" : "failed",
				exitCode,
				terminalId: run.terminalId ?? null,
				logPath: run.scriptFound ? (run.logPath ?? null) : null,
				log: run.log ?? "missing",
			});
			if (!succeeded && options.keepStateOnFailure === true) {
				return err(appError("setup_failed", SETUP_FAILED_MESSAGE));
			}
			const moved = await this.#finishSetup(workspaceId, succeeded);
			if (!moved.ok) return moved;
			return succeeded ? ok(undefined) : err(appError("setup_failed", SETUP_FAILED_MESSAGE));
		} finally {
			if (this.#setupStarting.get(workspaceId) === nonce) {
				this.#setupStarting.delete(workspaceId);
			}
		}
	}

	/** Reads the saved setup transcript for the Setup tab. */
	async readSetupLog(workspaceId: WorkspaceId): Promise<Result<string>> {
		const path = await this.#deps.repos.workspaces.getSetupLogPath(workspaceId);
		if (!path.ok) return path;
		if (path.value === null) {
			return err(appError("setup_log_missing", SETUP_LOG_MISSING_MESSAGE));
		}
		const text = await this.#deps.platform.fs.readText(path.value);
		return text.ok ? text : err(appError("setup_log_missing", SETUP_LOG_MISSING_MESSAGE));
	}

	/** Stops a running setup and shows "Cancelled setup script" instead of a failure. */
	async cancelSetup(workspaceId: WorkspaceId): Promise<Result<void>> {
		const current = this.store.getState().setup[workspaceId];
		const starting = this.#setupStarting.get(workspaceId);
		// A start that is still waiting on its row has no "running" state yet, but it must still
		// be cancelled rather than run after the user pressed Stop.
		if (current !== "running" && starting === undefined) return ok(undefined);
		this.#setupNonces.set(workspaceId, (this.#setupNonces.get(workspaceId) ?? 0) + 1);
		if (starting !== undefined && this.#setupStarting.get(workspaceId) === starting) {
			this.#setupStarting.delete(workspaceId);
		}
		this.#setSetupRun(workspaceId, { state: "stopping", exitCode: null, terminalId: null });
		let stopped: Result<void>;
		try {
			stopped = await this.#deps.scripts.stopWorkspace(workspaceId);
		} catch (cause) {
			stopped = err(appError("setup_stop_failed", "Couldn't stop the setup script.", cause));
		}
		this.#setSetupRun(workspaceId, { state: "cancelled", exitCode: null, terminalId: null });
		const finished = await this.#finishSetup(workspaceId, false);
		return stopped.ok ? finished : stopped;
	}

	/** Moves the workspace row to ready or failed after a setup run ends. */
	async #finishSetup(workspaceId: WorkspaceId, succeeded: boolean): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(workspaceId);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) return ok(undefined);
		const next = succeeded ? "ready" : "failed";
		if (workspace.state === next) return ok(undefined);
		if (workspace.state !== "initializing" && workspace.state !== "ready") return ok(undefined);
		const moved = await this.#deps.repos.workspaces.transitionState(
			workspaceId,
			workspace.state,
			next,
		);
		if (!moved.ok) return moved;
		if (moved.value) this.#upsert({ ...workspace, state: next, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Stores one setup run and keeps the older `setup` map in step for the status rule. */
	#setSetupRun(workspaceId: WorkspaceId, patch: Partial<SetupRun>): void {
		this.store.setState((state) => {
			const previous = state.setupRuns?.[workspaceId];
			const next: SetupRun = {
				state: "idle",
				exitCode: null,
				terminalId: null,
				logPath: null,
				log: "missing",
				interruptedReason: null,
				...previous,
				...patch,
			};
			return {
				...state,
				setup: { ...state.setup, [workspaceId]: next.state },
				setupRuns: { ...state.setupRuns, [workspaceId]: next },
			};
		});
	}

	/**
	 * Renames the placeholder branch once the first message tells what the work is
	 * (services-map 3.11). A missing suggestion or a failed one leaves the placeholder in place, as
	 * D030 says. A branch the user or the agent already changed is left alone.
	 */
	async renameBranchAfterFirstMessage(
		sessionId: SessionId,
		firstUserMessage: string,
	): Promise<Result<void>> {
		if (!this.#deps.setting<boolean>("auto_rename_new_branches")) return ok(undefined);
		const foundSession = await this.#deps.repos.sessions.get(sessionId);
		if (!foundSession.ok) return foundSession;
		if (foundSession.value === null) {
			return err(appError("session_unknown", "That chat no longer exists."));
		}
		const found = await this.#deps.repos.workspaces.get(foundSession.value.workspaceId);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		checkHost(workspace.host, "git");
		if (!workspace.branchIsPlaceholder || workspace.prNumber !== null) return ok(undefined);
		const message = firstUserMessage.trim();
		if (message === "") return ok(undefined);

		const checkedOut = await this.#deps.git.stdout(branchShowCurrent(), {
			cwd: workspace.path,
		});
		if (!checkedOut.ok) return checkedOut;
		if (checkedOut.value.trim() !== workspace.branch) return ok(undefined);

		const suggester = this.#deps.branchNames;
		if (suggester === undefined) return ok(undefined);
		const repoResult = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoResult.ok) return repoResult;
		const repo = repoResult.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));
		const config = await this.#deps.repoConfig(repo.id);
		if (!config.ok) return config;

		const suggestion = await suggester.suggestBranchName({
			session: foundSession.value,
			workspace,
			firstUserMessage: message,
			customPrompt: config.value.prompts.renameBranch,
		});
		// D030: a failed or empty suggestion keeps the placeholder and writes one log line.
		if (!suggestion.ok || suggestion.value === null) return ok(undefined);

		// The model call takes time, so read the row and the checkout again before writing: a user
		// or agent rename that landed meanwhile wins.
		const latest = await this.#deps.repos.workspaces.get(workspace.id);
		if (!latest.ok) return latest;
		const current = latest.value;
		if (current === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		if (!current.branchIsPlaceholder || current.prNumber !== null) return ok(undefined);
		const checkedOutAgain = await this.#deps.git.stdout(branchShowCurrent(), {
			cwd: current.path,
		});
		if (!checkedOutAgain.ok) return checkedOutAgain;
		if (checkedOutAgain.value.trim() !== current.branch) return ok(undefined);

		const prefix = await this.#creation.branchPrefix(repo);
		if (!prefix.ok) return prefix;
		const requestedName = `${prefix.value.prefix}${suggestion.value}`;
		if (!isSafeRefName(requestedName)) return err(invalidRefNameError(requestedName));
		const remote = await this.#creation.remoteFor(repo);
		if (!remote.ok) return remote;
		return renameBranchInWorktree(this.#deps.git, {
			worktreePath: current.path,
			repoRootPath: repo.rootPath,
			remote: remote.value,
			requestedName,
			onRenamed: (branch) => this.applyBranchRename(current.id, branch),
		});
	}

	/**
	 * Backs `Actions.workspaces.restart` (CLOUD-15): a cloud workspace's Worker saves its work to
	 * R2, stops the sandbox and starts a new one, then restores that work. A local workspace has no
	 * restart here: Conductor restarts only a remote workspace, through its backend.
	 */
	async restart(id: WorkspaceId): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		if (workspace.host.kind !== "cloud") {
			return err(appError("workspace_not_cloud", "Only a cloud workspace can restart here."));
		}
		const cloud = this.#deps.cloud;
		if (cloud === undefined) {
			return err(
				appError("cloud_not_paired", "The app cannot reach the Worker for this workspace."),
			);
		}
		const restarted = await restartCloudWorkspace(cloud, workspace.host);
		if (restarted.ok) await this.#deps.cloudState?.refresh(id);
		return restarted;
	}

	/** Backs `Actions.workspaces.archive`: the six steps of services-map 3.10, then the row. */
	archive(
		id: WorkspaceId,
		options: {
			deleteBranch: boolean;
			discardGitOperationState?: boolean;
			stopRunningAgents?: boolean;
		},
	): Promise<Result<void>> {
		return this.#archives.run(`archive:${id}`, () => this.#archiveNow(id, options));
	}

	async #archiveNow(
		id: WorkspaceId,
		options: {
			deleteBranch: boolean;
			discardGitOperationState?: boolean;
			stopRunningAgents?: boolean;
		},
	): Promise<Result<void>> {
		// CLOUD-10: the sandbox sleeps with the archive, so its forwards stop first (D110).
		await this.#deps.portForwards?.pauseWorkspace(id);
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		if (workspace.host.kind === "cloud") {
			return this.#archiveCloud(workspace);
		}
		if (isArchivedWorkspace(workspace)) return ok(undefined);
		if (workspace.state === "archiving") {
			return err(appError("workspace_archiving", "This workspace is already being archived."));
		}
		if (workspace.state === "initializing") {
			return err(appError("workspace_not_ready", ARCHIVE_NOT_READY_MESSAGE));
		}
		if (!(await this.#deps.platform.fs.exists(workspace.path))) {
			return err(appError("workspace_corrupted", WORKSPACE_CORRUPTED_MESSAGE));
		}
		if (this.#deps.sessions.hasWorkingChats(id) && options.stopRunningAgents !== true) {
			return err(appError("workspace_has_running_sessions", ARCHIVE_RUNNING_CHATS_MESSAGE));
		}

		const repoResult = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoResult.ok) return repoResult;
		const repo = repoResult.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const moved = await this.#deps.repos.workspaces.transitionState(
			id,
			workspace.state,
			"archiving",
		);
		if (!moved.ok) return moved;
		if (!moved.value) {
			return err(appError("workspace_not_ready", "This workspace cannot be archived now."));
		}
		this.#setArchiving(id, true);
		this.#upsert({ ...workspace, state: "archiving", updatedAt: this.#deps.now() });

		let worktreeRemoved = false;
		const rollBack = async (error: AppError): Promise<Result<never>> => {
			if (!worktreeRemoved) {
				const back = await this.#deps.repos.workspaces.transitionState(
					id,
					"archiving",
					workspace.state,
				);
				if (back.ok && back.value) {
					this.#upsert({ ...workspace, updatedAt: this.#deps.now() });
				}
			}
			this.#setArchiving(id, false);
			return err(error);
		};

		try {
			// A setup process can still be running on a row that has moved on, and a run action can
			// still be running too. Stop both before the snapshot so nothing writes into the worktree
			// while it is archived (services-map 3.10, 1.4).
			const setupState = this.store.getState().setup[id];
			const setupIsRunning =
				setupState === "running" || setupState === "detecting" || setupState === "stopping";
			const stopped = setupIsRunning
				? await this.cancelSetup(id)
				: await this.#deps.scripts.stopWorkspace(id);
			if (!stopped.ok) return await rollBack(stopped.error);
			this.#deps.scripts.clearRuns(id);

			const cancelled = await this.#deps.sessions.cancelAll(id);
			if (!cancelled.ok) return await rollBack(cancelled.error);

			const snapshot = await saveArchiveSnapshot(this.#deps.git, {
				workspaceId: id,
				checkpointerPath: this.#deps.checkpointerPath,
				worktreePath: workspace.path,
				discardGitOperationState: options.discardGitOperationState === true,
				fs: this.#deps.platform.fs,
			});
			if (!snapshot.ok) return await rollBack(snapshot.error);

			// The branch git reports is the one the archive keeps. A detached HEAD or a failed read
			// must stop the archive rather than record the name the row happened to have.
			const current = await this.#deps.git.stdout(branchShowCurrent(), {
				cwd: workspace.path,
			});
			if (!current.ok) return await rollBack(current.error);
			if (current.value === "") {
				return await rollBack(appError("git_detached_head", ARCHIVE_DETACHED_HEAD_MESSAGE));
			}
			const branch = current.value;
			if (branch !== workspace.branch) {
				const recorded = await this.#deps.repos.workspaces.setBranch(
					id,
					branch,
					workspace.branchIsPlaceholder,
				);
				if (!recorded.ok) return await rollBack(recorded.error);
			}

			const pinned = await pinArchiveHead(this.#deps.git, id, workspace.path);
			if (!pinned.ok) return await rollBack(pinned.error);

			const scripted = await this.#deps.scripts.runArchive(id);
			if (!scripted.ok) return await rollBack(scripted.error);

			const removal = await removeWorktree(this.#deps.git, this.#deps.platform.fs, {
				repoRootPath: repo.rootPath,
				worktreePath: workspace.path,
			});
			if (!removal.ok) return await rollBack(removal.error);
			worktreeRemoved = true;

			const marked = await this.#deps.repos.workspaces.markArchived(id, pinned.value);
			if (!marked.ok) {
				this.#setArchiving(id, false);
				return err(marked.error);
			}
			if (!marked.value) {
				this.#setArchiving(id, false);
				return err(appError("workspace_not_ready", "This workspace cannot be archived now."));
			}

			const at = this.#deps.now();
			this.#upsert({
				...workspace,
				branch,
				state: "archived",
				archiveCommit: pinned.value,
				archivedAt: at,
				updatedAt: at,
			});
			this.#setArchiving(id, false);

			const deleteBranch =
				options.deleteBranch || this.#deps.setting<boolean>("delete_branch_on_archive");
			if (deleteBranch && branch !== repo.defaultBranch) {
				const deleted = await this.#deps.git.runChecked(branchDeleteForce(branch), {
					cwd: repo.rootPath,
				});
				// The archive itself is finished. A branch that cannot be deleted is a warning for
				// the workspace's screen, not a failed archive (services-map 3.10 step 6).
				if (!deleted.ok) {
					this.#setArchiveWarning(
						id,
						`Couldn't delete the branch "${branch}": ${deleted.error.message}`,
					);
				}
			}
			return ok(undefined);
		} finally {
			this.#setArchiving(id, false);
		}
	}

	/**
	 * Archives a cloud workspace (CLOUD-08). There is no worktree on the Mac to snapshot, so the
	 * steps that make one are skipped: the branch's head is read through the workspace's Worker,
	 * the chats stop, the Worker saves the work to R2 and stops the sandbox, and the row is marked
	 * archived with that head. Unarchive is the row's own change; the next start restores the work.
	 */
	async #archiveCloud(workspace: Workspace): Promise<Result<void>> {
		const id = workspace.id;
		const cloud = this.#deps.cloud;
		if (cloud === undefined) {
			return err(
				appError("cloud_not_paired", "The app cannot reach the Worker for this workspace."),
			);
		}
		if (workspace.host.kind !== "cloud") {
			return err(appError("workspace_unknown", "That workspace is not a cloud workspace."));
		}
		if (isArchivedWorkspace(workspace)) return ok(undefined);
		if (workspace.state === "archiving") {
			return err(appError("workspace_archiving", "This workspace is already being archived."));
		}
		if (workspace.state === "initializing") {
			return err(appError("workspace_not_ready", ARCHIVE_NOT_READY_MESSAGE));
		}
		if (this.#deps.sessions.hasWorkingChats(id)) {
			return err(appError("workspace_has_running_sessions", ARCHIVE_RUNNING_CHATS_MESSAGE));
		}

		const moved = await this.#deps.repos.workspaces.transitionState(
			id,
			workspace.state,
			"archiving",
		);
		if (!moved.ok) return moved;
		if (!moved.value) {
			return err(appError("workspace_not_ready", "This workspace cannot be archived now."));
		}
		this.#setArchiving(id, true);
		this.#upsert({ ...workspace, state: "archiving", updatedAt: this.#deps.now() });

		const rollBack = async (error: AppError): Promise<Result<never>> => {
			await this.#deps.repos.workspaces.transitionState(id, "archiving", workspace.state);
			this.#setArchiving(id, false);
			return err(error);
		};

		try {
			// The sandbox is still up here, so its head is read through the same route git uses.
			const head = await this.#deps.git.stdout(revParseHead(), { cwd: workspace.path });
			if (!head.ok) return await rollBack(head.error);
			const commit = head.value.trim();
			if (commit === "") {
				return await rollBack(appError("git_detached_head", ARCHIVE_DETACHED_HEAD_MESSAGE));
			}

			const cancelled = await this.#deps.sessions.cancelAll(id);
			if (!cancelled.ok) return await rollBack(cancelled.error);

			const stopped = await stopCloudWorkspace(cloud, workspace.host);
			if (!stopped.ok) return await rollBack(stopped.error);

			const marked = await this.#deps.repos.workspaces.markArchived(id, commit);
			if (!marked.ok) {
				this.#setArchiving(id, false);
				return err(marked.error);
			}
			if (!marked.value) {
				this.#setArchiving(id, false);
				return err(appError("workspace_not_ready", "This workspace cannot be archived now."));
			}

			const at = this.#deps.now();
			this.#upsert({
				...workspace,
				state: "archived",
				archiveCommit: commit,
				archivedAt: at,
				updatedAt: at,
			});
			this.#setArchiving(id, false);
			// A cloud workspace's branch lives in its sandbox and in the backup. Nothing is deleted
			// on the Mac, so `deleteBranch` has nothing to do here.
			return ok(undefined);
		} finally {
			this.#setArchiving(id, false);
		}
	}

	/**
	 * Unarchives a cloud workspace (CLOUD-08). The work and the branch came back with the R2 backup
	 * the archive saved, so this only moves the row back to ready. A later start restores the
	 * sandbox from that backup (CLOUD-06); nothing is re-created on the Mac.
	 */
	async #unarchiveCloud(
		workspace: Workspace,
		options: { branchName: string | null; clearChats: boolean },
	): Promise<Result<UnarchiveOutcome>> {
		if (workspace.host.kind !== "cloud") {
			return err(appError("workspace_unknown", "That workspace is not a cloud workspace."));
		}
		if (!isArchivedWorkspace(workspace)) {
			return err(appError("workspace_not_archived", "This workspace is not archived."));
		}
		const id = workspace.id;
		const moved = await this.#deps.repos.workspaces.transitionState(id, "archived", "initializing");
		if (!moved.ok) return moved;
		if (!moved.value) {
			return err(appError("workspace_not_archived", "This workspace is not archived."));
		}
		const finished = await this.#deps.repos.workspaces.finishUnarchive(id, {
			// A cloud workspace's branch cannot be re-created on the Mac, so a requested name has no
			// meaning here; the branch that the backup holds comes back.
			branch: workspace.branch,
			directoryName: workspace.directoryName,
			path: workspace.path,
		});
		if (!finished.ok || !finished.value) {
			await this.#deps.repos.workspaces.transitionState(id, "initializing", "archived");
			return finished.ok
				? err(appError("workspace_not_archived", "This workspace could not be restored."))
				: finished;
		}
		const at = this.#deps.now();
		this.#upsert({
			...workspace,
			state: "ready",
			archivedAt: null,
			lastActivityAt: Math.max(workspace.lastActivityAt, at),
			updatedAt: at,
		});
		if (options.clearChats) {
			const cleared = await this.#deps.sessions.deleteAll(id);
			if (!cleared.ok) return cleared;
		}
		return ok({ needsBranchName: false, uncommittedChangesLost: false });
	}

	/**
	 * Finishes or rolls back workspaces that a crash left in `archiving`. A missing folder means
	 * the archive got as far as removing the worktree, so the row is finished with the commit
	 * repair read; a folder still on disk means the archive stopped early, so the row goes back
	 * to ready and can be archived again.
	 */
	async recoverArchiving(workspaces: readonly ArchivingWorkspace[]): Promise<Result<void>> {
		for (const row of workspaces) {
			if (row.folderExists) {
				const back = await this.#deps.repos.workspaces.transitionState(
					row.id,
					"archiving",
					"ready",
				);
				if (!back.ok) return back;
			} else {
				const finished = await this.#deps.repos.workspaces.markArchived(row.id, row.archiveCommit);
				if (!finished.ok) return finished;
			}
		}
		return ok(undefined);
	}

	/**
	 * Backs `Actions.workspaces.unarchive`: re-adds the worktree and restores the archive snapshot.
	 * A branch that is gone is recreated from the archive commit. A branch that is checked out
	 * elsewhere or has moved gives `needsBranchName` and changes nothing, so the screen can ask
	 * for a new name. A checkpoint restore that fails only sets `uncommittedChangesLost`.
	 */
	async unarchive(
		id: WorkspaceId,
		options: { branchName: string | null; clearChats: boolean },
	): Promise<Result<UnarchiveOutcome>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		if (workspace.host.kind === "cloud") {
			return this.#unarchiveCloud(workspace, options);
		}
		if (!isArchivedWorkspace(workspace)) {
			return err(appError("workspace_not_archived", "This workspace is not archived."));
		}

		const repoFound = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoFound.ok) return repoFound;
		const repo = repoFound.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const current = await readBranchState(this.#deps.git, repo.rootPath, workspace.branch);
		if (!current.ok) return current;
		const kind = classifyUnarchive({
			branchExists: current.value.exists,
			checkedOutElsewhere: current.value.checkedOutElsewhere,
			branchTip: current.value.tip,
			archiveCommit: workspace.archiveCommit,
		});

		let branch = workspace.branch;
		let createFrom: string | null = null;

		if (options.branchName !== null) {
			branch = options.branchName;
			if (!isSafeRefName(branch)) return err(invalidRefNameError(branch));
			const chosen = await readBranchState(this.#deps.git, repo.rootPath, branch);
			if (!chosen.ok) return chosen;
			if (chosen.value.checkedOutElsewhere) {
				return err(appError("branch_checked_out_elsewhere", BRANCH_CHECKED_OUT_MESSAGE));
			}
			if (chosen.value.exists) {
				return err(appError("branch_exists", `A branch named "${branch}" already exists.`));
			}
			if (workspace.archiveCommit === null) {
				return err(appError("archive_commit_missing", ARCHIVE_COMMIT_MISSING_MESSAGE));
			}
			createFrom = workspace.archiveCommit;
		} else if (kind === "branchTaken" || kind === "branchDiverged") {
			return ok({ needsBranchName: true, uncommittedChangesLost: false });
		} else if (kind === "branchDeleted") {
			if (workspace.archiveCommit === null) {
				return err(appError("archive_commit_missing", ARCHIVE_COMMIT_MISSING_MESSAGE));
			}
			createFrom = workspace.archiveCommit;
		}

		const listed = await this.#deps.repos.workspaces.listByRepo(repo.id);
		if (!listed.ok) return listed;
		const others = listed.value.filter((row) => row.id !== id);
		const root = this.#worktreesRoot();
		const reachable = await this.#registerFolders([root]);
		if (!reachable.ok) return reachable;
		let directoryName = workspace.directoryName;
		let worktreePath = workspace.path;
		const pathFree = !(await this.#deps.platform.fs.exists(worktreePath));
		const nameTaken = others.some((row) => row.directoryName === directoryName);
		if (!pathFree || nameTaken) {
			const taken = new Set(others.map((row) => row.directoryName));
			if (!pathFree) taken.add(directoryName);
			const picked = await nextFreeName(directoryName, async (candidate) => {
				if (taken.has(candidate)) return ok(true);
				return ok(
					await this.#deps.platform.fs.exists(worktreeFolderFor(root, repo.name, candidate)),
				);
			});
			if (!picked.ok) return picked;
			directoryName = picked.value;
			worktreePath = worktreeFolderFor(root, repo.name, directoryName);
		}

		const moved = await this.#deps.repos.workspaces.transitionState(id, "archived", "initializing");
		if (!moved.ok) return moved;
		if (!moved.value) {
			return err(appError("workspace_not_archived", "This workspace is not archived."));
		}
		this.#upsert({ ...workspace, state: "initializing", updatedAt: this.#deps.now() });

		/**
		 * Undoes a restore that failed: removes the re-added folder when there is one, deletes a
		 * branch this call created, and sets the state back to archived. Each step's failure is
		 * added to the message, so a folder, branch or state left behind is never hidden.
		 */
		const rollBack = async (message: string, removeFolder: boolean): Promise<string> => {
			const notes = [message];
			if (removeFolder) {
				const removed = await removeWorktree(this.#deps.git, this.#deps.platform.fs, {
					repoRootPath: repo.rootPath,
					worktreePath,
				});
				if (!removed.ok) {
					notes.push(`The folder "${worktreePath}" also stays: ${removed.error.message}`);
				}
			}
			if (createFrom !== null) {
				const deleted = await this.#deps.git.runChecked(branchDeleteForce(branch), {
					cwd: repo.rootPath,
				});
				if (!deleted.ok) notes.push(`The new branch "${branch}" also stays.`);
			}
			const back = await this.#deps.repos.workspaces.transitionState(
				id,
				"initializing",
				"archived",
			);
			if (!back.ok) {
				notes.push(
					`The workspace could not be set back to archived and stays initializing: ${back.error.message}`,
				);
			} else if (!back.value) {
				notes.push(
					"The workspace changed while it was being restored, so it was not set back to archived.",
				);
			} else {
				this.#upsert(workspace);
			}
			return notes.join(" ");
		};

		const added = await this.#deps.git.withWorktreeAndRepoLocks(worktreePath, repo.rootPath, () =>
			addWorktreeOnBranch(this.#deps.git, {
				repoRootPath: repo.rootPath,
				worktreePath,
				branch,
				createFrom,
			}),
		);
		if (!added.ok) {
			const message = await rollBack(added.error.message, false);
			return err(appError(added.error.code, message, added.error));
		}

		const restored = await restoreArchiveCheckpoint(
			this.#deps.git,
			this.#deps.checkpointerPath,
			id,
			worktreePath,
		);
		const uncommittedChangesLost = !restored.ok;

		const finished = await this.#deps.repos.workspaces.finishUnarchive(id, {
			branch,
			directoryName,
			path: worktreePath,
		});
		if (!finished.ok || !finished.value) {
			const message = await rollBack(
				finished.ok ? "This workspace could not be restored." : finished.error.message,
				true,
			);
			return finished.ok
				? err(appError("workspace_not_archived", message))
				: err(appError(finished.error.code, message, finished.error));
		}

		const at = this.#deps.now();
		this.#upsert({
			...workspace,
			branch,
			directoryName,
			path: worktreePath,
			state: "ready",
			archivedAt: null,
			lastActivityAt: Math.max(workspace.lastActivityAt, at),
			updatedAt: at,
		});

		if (options.clearChats) {
			const cleared = await this.#deps.sessions.deleteAll(id);
			if (!cleared.ok) return cleared;
		}

		// A complete restore was archived with its dependencies in place. Conductor runs the setup
		// script again here; a setup failure belongs to the Setup tab, not to the unarchive.
		await this.runSetup(id, { keepStateOnFailure: true });

		return ok({ needsBranchName: false, uncommittedChangesLost });
	}

	/**
	 * Moves a workspace's recent activity forward (services-map.md 2.3.1). The database row is the
	 * home and the loaded row mirrors it, as every other workspace field does. A time at or before
	 * the stored one changes nothing, so activity never moves backwards.
	 */
	async touchActivity(id: WorkspaceId, at: number): Promise<Result<void>> {
		const written = await this.#deps.repos.workspaces.touchActivity(id, at);
		if (!written.ok) return written;
		this.store.setState((state) => {
			const current = state.workspacesById[id];
			if (current === undefined || current.lastActivityAt >= at) return {};
			return {
				workspacesById: { ...state.workspacesById, [id]: { ...current, lastActivityAt: at } },
			};
		});
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.setLinkedPaths`: the extra folders agents may read and edit. */
	async setLinkedPaths(id: WorkspaceId, paths: readonly string[]): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const normalised = normaliseLinkedPaths(paths);
		if (!normalised.ok) return normalised;
		const written = await this.#deps.repos.workspaces.setLinkedPaths(id, normalised.value);
		if (!written.ok) return written;
		this.#upsert({
			...found.value,
			linkedPaths: normalised.value,
			updatedAt: this.#deps.now(),
		});
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.remove`. */
	remove(id: WorkspaceId): Promise<Result<void>> {
		return this.#removals.run(`remove:${id}`, () => this.#removeNow(id, false));
	}

	/** Removes every workspace of a repository. Used when the repository is removed. */
	async removeWorkspacesOf(repoId: RepoId): Promise<Result<void>> {
		const listed = await this.#deps.repos.workspaces.listByRepo(repoId);
		if (!listed.ok) return listed;
		const ids = listed.value.map((workspace) => workspace.id);
		if (ids.length === 0) return ok(undefined);
		const stopped = await this.#deps.scripts.stopAllForRepository(ids);
		if (!stopped.ok) return stopped;
		for (const id of ids) {
			const removed = await this.#removals.run(`remove:${id}`, () => this.#removeNow(id, true));
			if (!removed.ok) return removed;
		}
		return ok(undefined);
	}

	/**
	 * Deletes one workspace. Everything that can refuse runs before the first irreversible step:
	 * cancelling chats, stopping processes and removing the worktree. The archive ref and the app
	 * data files go next, then the chats and the row. A step that fails leaves the rest for a retry.
	 */
	async #removeNow(id: WorkspaceId, processesStopped: boolean): Promise<Result<void>> {
		// CLOUD-10: deleting a workspace stops its forwards first (D110).
		await this.#deps.portForwards?.pauseWorkspace(id);
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		// Deleting a workspace that is already gone changes nothing.
		if (workspace === null) return ok(undefined);
		if (workspace.host.kind === "cloud") return this.#removeCloudNow(workspace);

		const repo = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repo.ok) return repo;
		if (repo.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		const repoRootPath = repo.value.rootPath;

		const cancelled = await this.#deps.sessions.cancelAll(id);
		if (!cancelled.ok) return cancelled;

		if (!processesStopped) {
			const stopped = await this.#deps.scripts.stopWorkspace(id);
			if (!stopped.ok) return stopped;
		}

		if (await this.#deps.platform.fs.exists(workspace.path)) {
			const removed = await removeWorktree(this.#deps.git, this.#deps.platform.fs, {
				repoRootPath,
				worktreePath: workspace.path,
			});
			if (!removed.ok) return removed;
		}

		// The archive ref keeps the last commit reachable until the workspace itself is deleted.
		if (await this.#deps.platform.fs.exists(repoRootPath)) {
			const archiveDeleted = await this.#deps.git.runChecked(updateRefDelete(archiveRef(id)), {
				cwd: repoRootPath,
			});
			if (!archiveDeleted.ok) return archiveDeleted;
		}

		const setupLog = await trashIfPresent(
			this.#deps.platform.fs,
			setupLogFile(this.#deps.platform.fs.paths, id),
		);
		if (!setupLog.ok) return setupLog;
		const viewed = await trashIfPresent(
			this.#deps.platform.fs,
			viewedFilesFile(this.#deps.platform.fs.paths, id),
		);
		if (!viewed.ok) return viewed;
		// Cursor's SDK keeps one run store per workspace path; nothing else ever removes it (D084).
		const cursorStore = await trashIfPresent(
			this.#deps.platform.fs,
			await cursorStoreFolder(this.#deps.platform.fs.paths, workspace.path),
		);
		if (!cursorStore.ok) return cursorStore;
		const cached = await this.#deps.gitCache?.remove(id);
		if (cached !== undefined && !cached.ok) return cached;

		const chats = await this.#deps.sessions.deleteAll(id);
		if (!chats.ok) return chats;

		const deleted = await this.#deps.repos.workspaces.delete(id);
		if (!deleted.ok) return deleted;

		this.#deps.scripts.clearRuns(id);
		this.#forgetWorkspace(id);
		return ok(undefined);
	}

	/**
	 * Deletes a cloud workspace (CLOUD-08). Its Worker removes the R2 backups, the sandbox and the
	 * Durable Object's storage; its chats and row go from the local database, as they do for a Mac
	 * workspace. Nothing on this Mac is touched: a cloud workspace has no worktree here.
	 */
	async #removeCloudNow(workspace: Workspace): Promise<Result<void>> {
		if (workspace.host.kind !== "cloud") {
			return err(appError("workspace_unknown", "That workspace is not a cloud workspace."));
		}
		const cloud = this.#deps.cloud;
		if (cloud === undefined) {
			return err(
				appError("cloud_not_paired", "The app cannot reach the Worker for this workspace."),
			);
		}
		const id = workspace.id;
		const cancelled = await this.#deps.sessions.cancelAll(id);
		if (!cancelled.ok) return cancelled;
		const removed = await removeCloudWorkspace(cloud, workspace.host);
		if (!removed.ok) return removed;
		const chats = await this.#deps.sessions.deleteAll(id);
		if (!chats.ok) return chats;
		const deleted = await this.#deps.repos.workspaces.delete(id);
		if (!deleted.ok) return deleted;
		this.#deps.scripts.clearRuns(id);
		this.#forgetWorkspace(id);
		return ok(undefined);
	}

	/** Forgets a deleted workspace and every in-memory value kept for it. */
	#forgetWorkspace(id: WorkspaceId): void {
		this.store.setState((state) => {
			const workspacesById = { ...state.workspacesById };
			delete workspacesById[id];
			const setup = { ...state.setup };
			delete setup[id];
			const setupRuns = { ...(state.setupRuns ?? {}) };
			delete setupRuns[id];
			const archiving = { ...state.archiving };
			delete archiving[id];
			const archiveWarnings = { ...(state.archiveWarnings ?? {}) };
			delete archiveWarnings[id];
			const warnings = { ...(state.warnings ?? {}) };
			delete warnings[id];
			const failedFirstInputs = { ...(state.failedFirstInputs ?? {}) };
			delete failedFirstInputs[id];
			return {
				...state,
				workspacesById,
				setup,
				setupRuns,
				archiving,
				archiveWarnings,
				warnings,
				failedFirstInputs,
				lastFailedCreate: state.lastFailedCreate?.id === id ? null : state.lastFailedCreate,
			};
		});
	}

	/**
	 * PR-10: stores the pull request the user linked by URL or number and keeps the loaded row in
	 * step, so the next poll and every screen read the new number.
	 */
	async setLinkedPullRequest(
		id: WorkspaceId,
		pr: { number: number; title: string | null; description: string | null },
	): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		const written = await this.#deps.repos.workspaces.setPullRequest(id, pr);
		if (!written.ok) return written;
		this.#upsert({
			...found.value,
			prNumber: pr.number,
			prTitle: pr.title,
			prDescription: pr.description,
			updatedAt: this.#deps.now(),
		});
		return ok(undefined);
	}

	/**
	 * Called by the GitHub service when a PR merges; archives when `archive_on_merge` asks for it.
	 * The stack exception is decided by the poll before this call, because the stack belongs to
	 * GitHub.
	 */
	async onPullRequestMerged(id: WorkspaceId, prNumber: number): Promise<Result<void>> {
		if (!this.#deps.setting<boolean>("archive_on_merge")) return ok(undefined);
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		if (
			isArchivedWorkspace(workspace) ||
			workspace.state === "archiving" ||
			workspace.archiveCommit !== null
		) {
			return ok(undefined);
		}
		if (workspace.prNumber !== null && workspace.prNumber !== prNumber) return ok(undefined);
		if (!(await this.#deps.platform.fs.exists(workspace.path))) {
			return err(appError("workspace_corrupted", WORKSPACE_CORRUPTED_MESSAGE));
		}
		return this.archive(id, { deleteBranch: false });
	}

	/**
	 * GIT-09: saves the branch git renamed, so the header and sidebar show the new name. WS-04's
	 * "Rename the workspace with its branch" setting then renames an unnamed workspace to the new
	 * branch, and a failed name write puts the branch row back so the two agree.
	 */
	async applyBranchRename(id: WorkspaceId, branch: string): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		const written = await this.#deps.repos.workspaces.setBranch(id, branch, false);
		if (!written.ok) return written;
		const at = this.#deps.now();
		let displayName = found.value.displayName;
		const followBranch =
			displayName === null &&
			this.#deps.setting<boolean>("auto_rename_workspace_on_branch_name_set");
		if (followBranch) {
			const named = await this.#deps.repos.workspaces.setDisplayName(id, branch);
			if (!named.ok) {
				const back = await this.#deps.repos.workspaces.setBranch(
					id,
					found.value.branch,
					found.value.branchIsPlaceholder,
				);
				return back.ok ? named : err(appError(named.error.code, named.error.message, back.error));
			}
			displayName = branch;
		}
		this.#upsert({
			...found.value,
			branch,
			branchIsPlaceholder: false,
			displayName,
			updatedAt: at,
		});
		return ok(undefined);
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

	/** Pins a workspace at the top of the list, or unpins it. Backs `Actions.workspaces.setPinned`. */
	async setPinned(id: WorkspaceId, pinned: boolean): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const pinnedAt = pinned ? this.#deps.now() : null;
		const written = await this.#deps.repos.workspaces.setPinned(id, pinnedAt);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, pinnedAt, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/**
	 * GIT-08: stores the workspace's intended target branch and keeps the loaded row in step. The
	 * git work that follows (the open PR's base, or a fetch and reset) belongs to the GitService.
	 */
	async setIntendedTargetBranch(id: WorkspaceId, targetBranch: string): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const written = await this.#deps.repos.workspaces.setTargetBranch(id, targetBranch);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, targetBranch, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Stores the workspace's user-set Kanban status and keeps the loaded row in step. */
	async setKanbanStatus(id: WorkspaceId, status: KanbanStatus): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const written = await this.#deps.repos.workspaces.setKanbanStatus(id, status);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, kanbanStatus: status, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Backs a workspace-level mark-read: the chats service clears the workspace's unread chats. */
	markRead(id: WorkspaceId): Promise<Result<void>> {
		return this.#deps.sessions.markAllRead(id);
	}

	/**
	 * Backs `Actions.workspaces.openIn`: opens the workspace folder in another app. Kaleidoscope is a
	 * diff tool, so as in Conductor (renderApp @2492504, services-map.md 3.11) a workspace with
	 * changes against HEAD opens those changes through `git difftool` with ksdiff; a workspace
	 * with none opens its folder in the app.
	 */
	async openIn(id: WorkspaceId, appName: string): Promise<Result<void>> {
		const workspace = this.store.getState().workspacesById[id];
		if (workspace === undefined)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		checkHost(workspace.host, "open-in");
		// A cloud workspace has no folder on this Mac: its editor opens over SSH (CLOUD-12).
		if (workspace.host.kind === "cloud") return this.openRemoteIn(id, appName);
		if (appName === KALEIDOSCOPE_APP) {
			const cwd = workspace.path;
			const changed = await this.#deps.git.runChecked(diffQuietHead(), { cwd });
			if (!changed.ok) return changed;
			if (changed.value.exitCode === 1) {
				const opened = await this.#deps.git.runChecked(diffToolKsdiff(), { cwd });
				return opened.ok ? ok(undefined) : opened;
			}
		}
		return this.#deps.platform.opener.openWith(appName, workspace.path);
	}

	/**
	 * Backs `Actions.workspaces.openRemoteIn` (CLOUD-12): opens a cloud workspace's folder in VS
	 * Code, Cursor or Zed over its SSH door. Another app gets Conductor's refusal.
	 */
	async openRemoteIn(id: WorkspaceId, appName: string): Promise<Result<void>> {
		const workspace = this.store.getState().workspacesById[id];
		if (workspace === undefined)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		if (workspace.host.kind === "local") return this.openIn(id, appName);
		const deps = this.#sshDeps();
		if (deps === null)
			return err(appError("cloud_not_paired", "This Mac is not paired with a cloud Workspace."));
		return openRemoteWorkspace(deps, workspace, appName);
	}

	/**
	 * Backs `Actions.workspaces.copySshCommand`: opens the workspace's SSH door and returns
	 * Conductor's `ssh <name>.conducted` text for the clipboard.
	 */
	async copySshCommand(id: WorkspaceId): Promise<Result<string>> {
		const workspace = this.store.getState().workspacesById[id];
		if (workspace === undefined)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		if (workspace.host.kind === "local")
			return err(appError("ssh_not_cloud", "Only a cloud workspace can be opened over SSH."));
		const deps = this.#sshDeps();
		if (deps === null)
			return err(appError("cloud_not_paired", "This Mac is not paired with a cloud Workspace."));
		const session = await ensureSshSession(deps, workspace);
		if (!session.ok) return session;
		return ok(sshCommand(session.value.hostname));
	}

	/** The Platform slice the SSH door uses, or null when the composition root kept the Worker out. */
	#sshDeps(): SshDeps | null {
		const cloud = this.#deps.cloud;
		if (cloud === undefined) return null;
		return {
			fs: this.#deps.platform.fs,
			shell: this.#deps.platform.shell,
			opener: this.#deps.platform.opener,
			portForward: this.#deps.platform.portForward,
			cloud,
			sshKeyPath: () => this.#deps.setting<string>("ssh_key_path"),
		};
	}

	/** Backs `Actions.workspaces.setActiveSession`: remembers the chat tab for the next launch. */
	async setActiveSession(id: WorkspaceId, sessionId: SessionId): Promise<Result<void>> {
		const written = await this.#deps.repos.workspaces.setActiveSession(id, sessionId);
		if (!written.ok) return written;
		const current = this.store.getState().workspacesById[id];
		if (current !== undefined) this.#upsert({ ...current, activeSessionId: sessionId });
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.retrySetup`. A second call while setup runs is ignored. */
	async retrySetup(id: WorkspaceId): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		checkHost(workspace.host, "shell");
		if (workspace.state !== "failed" && workspace.state !== "ready") return ok(undefined);

		const repoResult = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoResult.ok) return repoResult;
		const repo = repoResult.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const moved = await this.#deps.repos.workspaces.transitionState(
			id,
			workspace.state,
			"initializing",
		);
		if (!moved.ok) return moved;
		// Another retry moved the row first, so its run does the work.
		if (!moved.value) return ok(undefined);
		const initializing = { ...workspace, state: "initializing" as const };
		this.#upsert({ ...initializing, updatedAt: this.#deps.now() });

		const remote = await this.#creation.remoteFor(repo);
		if (!remote.ok) return this.#creation.fail(initializing, remote.error);
		const materialised = await this.#creation.materialise(initializing, repo, remote.value);
		if (!materialised.ok) return materialised;
		this.#baseShas.delete(id);
		this.#creation.addWarnings(id, materialised.value.warnings);

		// A failed creation kept its first message, so a successful retry can start the chat.
		const firstInput = this.store.getState().failedFirstInputs?.[id];
		if (firstInput !== undefined) await this.#creation.startFirstChat(id, firstInput);
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.recoverPrompt`. */
	async recoverPrompt(id: WorkspaceId): Promise<Result<Draft>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		// A creation that failed keeps its first message here. That is more complete than the chat's
		// draft row, which may not exist yet or may have been cleared.
		const kept = this.store.getState().failedFirstInputs?.[id];
		if (kept !== undefined) {
			return ok({ text: kept.prompt, attachmentPaths: [...kept.attachmentPaths] });
		}
		return this.#deps.sessions.firstDraftOf(id);
	}

	/**
	 * Backs `Actions.workspaces.addToBacklog`: saves the draft without making a worktree. Refused
	 * while the "Unstarted workspaces" setting is off, which is where the rule lives; screens only
	 * hide the button.
	 */
	async addToBacklog(input: NewWorkspaceInput): Promise<Result<BacklogWorkspace>> {
		if (this.#deps.setting<boolean>("unstarted_workspaces_enabled") === false) {
			return err(
				appError(
					"backlog_off",
					"The backlog is turned off. Turn on Unstarted workspaces in Settings, Experimental.",
				),
			);
		}
		const found = await this.#deps.repos.repos.get(input.repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		if (input.from.kind !== "default") {
			return err(
				appError(
					"backlog_base_unsupported",
					"A backlog workspace starts from the default branch. Create it now to use a branch, pull request or issue.",
				),
			);
		}
		const saved = await this.#deps.repos.backlogWorkspaces.create({
			repoId: input.repoId,
			displayName: null,
			prompt: input.prompt,
			attachmentPaths: [...input.attachmentPaths],
			config: input.config,
			sectionId: input.sectionId,
		});
		if (!saved.ok) return saved;
		this.#upsertBacklog(saved.value);
		return saved;
	}

	/** Backs `Actions.workspaces.startFromBacklog`: the normal create flow, keeping its draft. */
	async startFromBacklog(id: WorkspaceId): Promise<Result<Workspace>> {
		const found = await this.#deps.repos.backlogWorkspaces.get(id);
		if (!found.ok) return found;
		const entry = found.value;
		if (entry === null) {
			return err(appError("workspace_unknown", "That backlog workspace no longer exists."));
		}
		if (entry.repoId === null) {
			return err(appError("repo_unknown", NO_READY_REPOSITORY_MESSAGE));
		}
		const repoId = entry.repoId;
		const repo = await this.#deps.repos.repos.get(repoId);
		if (!repo.ok) return repo;
		if (repo.value === null) {
			return err(appError("repo_unknown", NO_READY_REPOSITORY_MESSAGE));
		}
		// The entry goes first: a removal that fails starts nothing, so a second Start can never
		// make a second workspace from the same draft.
		const removed = await this.#deps.repos.backlogWorkspaces.delete(id);
		if (!removed.ok) return removed;
		this.#forgetBacklog(id);
		const failedBefore = this.store.getState().lastFailedCreate;
		const created = await this.create({
			repoId,
			from: { kind: "default" },
			prompt: entry.prompt,
			attachmentPaths: [...entry.attachmentPaths],
			config: entry.config,
			sectionId: entry.sectionId,
		});
		if (created.ok) return created;
		// A create that made a failed workspace keeps the draft there (Retry setup, Recover prompt),
		// so the entry stays gone. One that failed before that puts the entry back as it was.
		const failedAfter = this.store.getState().lastFailedCreate;
		if (failedAfter !== null && failedAfter !== undefined && failedAfter !== failedBefore) {
			return created;
		}
		const restored = await this.#deps.repos.backlogWorkspaces.restore(entry);
		if (!restored.ok) {
			return err(
				appError(
					"backlog_restore_failed",
					`${created.error.message} The backlog entry could not be put back: ${restored.error.message}`,
					restored.error,
				),
			);
		}
		this.#upsertBacklog(entry);
		return created;
	}

	/**
	 * Backs `Actions.workspaces.setBacklogRepo`: the repository a backlog workspace starts in, for
	 * one whose repository was removed (WS-11).
	 */
	async setBacklogRepo(id: WorkspaceId, repoId: RepoId): Promise<Result<void>> {
		const repo = await this.#deps.repos.repos.get(repoId);
		if (!repo.ok) return repo;
		if (repo.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		const written = await this.#deps.repos.backlogWorkspaces.setRepo(id, repoId);
		if (!written.ok) return written;
		const current = this.store.getState().backlogById[id];
		if (current !== undefined)
			this.#upsertBacklog({ ...current, repoId, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/**
	 * Called after a repository row was deleted: the database set its backlog workspaces' repository
	 * to null (migration 0008), and the store follows, so the backlog asks for a repository.
	 */
	releaseBacklogOf(repoId: RepoId): void {
		this.store.setState((state) => {
			let changed = false;
			const backlogById: Record<string, BacklogWorkspace> = {};
			for (const [id, entry] of Object.entries(state.backlogById)) {
				if (entry.repoId === repoId) {
					changed = true;
					backlogById[id] = { ...entry, repoId: null };
				} else {
					backlogById[id] = entry;
				}
			}
			return changed ? { ...state, backlogById } : state;
		});
	}

	/** Backs `Actions.workspaces.removeFromBacklog`. */
	async removeFromBacklog(id: WorkspaceId): Promise<Result<void>> {
		const removed = await this.#deps.repos.backlogWorkspaces.delete(id);
		if (!removed.ok) return removed;
		this.#forgetBacklog(id);
		return ok(undefined);
	}

	/** Puts a saved backlog workspace in the store, so the backlog screen shows it after saving. */
	#upsertBacklog(entry: BacklogWorkspace): void {
		this.store.setState((state) => ({
			...state,
			backlogById: { ...state.backlogById, [entry.id]: entry },
		}));
	}

	#forgetBacklog(id: WorkspaceId): void {
		this.store.setState((state) => {
			const backlogById = { ...state.backlogById };
			delete backlogById[id];
			return { ...state, backlogById };
		});
	}

	/** Keeps the ids of workspaces being archived, so the sidebar can show that state (1.5). */
	#setArchiving(id: WorkspaceId, archiving: boolean): void {
		this.store.setState((state) => {
			const next = { ...state.archiving };
			if (archiving) next[id] = true;
			else delete next[id];
			return { ...state, archiving: next };
		});
	}

	/** Keeps a side step's failure after the archive has finished, so a screen can show it. */
	#setArchiveWarning(id: WorkspaceId, warning: string): void {
		this.store.setState((state) => ({
			...state,
			archiveWarnings: { ...(state.archiveWarnings ?? {}), [id]: warning },
		}));
	}

	/** Puts one workspace in the store, so the sidebar shows it before the git work finishes. */
	#upsert(workspace: Workspace): void {
		this.store.setState((state) => ({
			...state,
			workspacesById: { ...state.workspacesById, [workspace.id]: workspace },
		}));
	}
}
