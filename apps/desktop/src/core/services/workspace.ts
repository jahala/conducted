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
 * (`initializing`) and the slow git work happens after the row exists. Place names come from our
 * own tiered source in this file (`createPlaceNames`, D002), which the composition root should
 * pass in place of any other list. Creation ends
 * in `ready` until WS-03 adds the setup run and its copied files; a pull-request or issue base
 * waits for WS-02. Warnings and the first message of a failed creation live in the service's
 * in-memory store: the contract's `Workspace` row has no field for them, and the create page reads
 * them back after the action returns. Calls to `repoConfig` and `defaultConfig` are optional
 * because the composition root passes them in a later wiring change.
 * Test first: classifyUnarchive returns "branchTaken" when the branch is checked out elsewhere.
 */
import type { SessionConfig } from "@conducted/protocol";
import {
	type AppError,
	appError,
	err,
	notImplemented,
	ok,
	type RepoId,
	type Result,
	type SectionId,
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
import type {
	BacklogWorkspace,
	KanbanStatus,
	Repo,
	RepoConfig,
	Session,
	Workspace,
} from "../model.ts";
import { allocatePort } from "./ports.ts";

export interface PlaceNames {
	/** A place name that is not in `taken`. */
	pick(taken: ReadonlySet<string>): string;
}

/**
 * The names a workspace folder can take, grouped by how often they are chosen (frontend.md 6).
 * This is our own list (D002); a name is never copied from Conductor's bundled city files.
 */
export const PLACE_NAME_TIERS: Readonly<Record<string, readonly string[]>> = {
	common: [
		"amber",
		"arden",
		"ash",
		"bay",
		"birch",
		"bloom",
		"brook",
		"cedar",
		"cliff",
		"cove",
		"dawn",
		"dell",
		"dune",
		"elm",
		"fern",
		"field",
		"flint",
		"ford",
		"glen",
		"grove",
		"harbor",
		"heath",
		"hill",
		"isle",
		"lake",
		"landing",
		"leaf",
		"linden",
		"marsh",
		"meadow",
		"mill",
		"moss",
		"oak",
		"orchard",
		"pier",
		"pine",
		"pond",
		"reed",
		"ridge",
		"river",
		"rock",
		"sand",
		"shore",
		"spring",
		"stone",
		"thicket",
		"trail",
		"vale",
		"willow",
		"wood",
	],
	uncommon: [
		"aurora",
		"basalt",
		"beacon",
		"bramble",
		"cascade",
		"cinder",
		"citadel",
		"cobalt",
		"compass",
		"coral",
		"crescent",
		"crystal",
		"ember",
		"falcon",
		"garnet",
		"granite",
		"hollow",
		"indigo",
		"juniper",
		"lagoon",
		"lantern",
		"marble",
		"monsoon",
		"obsidian",
		"onyx",
		"otter",
		"pebble",
		"quartz",
		"raven",
		"saffron",
		"sequoia",
		"sparrow",
		"summit",
		"thistle",
		"tide",
		"timber",
		"topaz",
		"tundra",
		"velvet",
		"wander",
	],
	rare: [
		"albatross",
		"borealis",
		"canyon",
		"cathedral",
		"celestial",
		"cindercone",
		"daybreak",
		"deepwater",
		"everglade",
		"fathom",
		"firefly",
		"glacier",
		"goldenrod",
		"halcyon",
		"highland",
		"horizon",
		"labyrinth",
		"lighthouse",
		"meridian",
		"moonrise",
		"nightfall",
		"outpost",
		"parallax",
		"peregrine",
		"pinnacle",
		"polaris",
		"quarry",
		"redwood",
		"ridgeway",
		"starfall",
		"stonebridge",
		"tempest",
		"thunderhead",
		"wayfarer",
		"westwind",
	],
	legendary: [
		"atlantis",
		"avalon",
		"camelot",
		"elderwood",
		"everest",
		"hyperion",
		"olympus",
		"phoenix",
		"shangrila",
		"titan",
		"valhalla",
		"zenith",
	],
};

/** How often each tier is tried before the next one (frontend.md 6's rarity tiers). */
const TIER_WEIGHTS: Readonly<Record<string, number>> = {
	common: 8,
	uncommon: 4,
	rare: 2,
	legendary: 1,
};

/**
 * The real place-name source (frontend.md 6). It picks from the rarity tiers, and when every name
 * in the list is taken it appends a numeric suffix until the name is free, so `pick` always
 * honours its promise that the result is not in `taken`.
 */
export function createPlaceNames(random: () => number = Math.random): PlaceNames {
	const tiers = Object.entries(PLACE_NAME_TIERS).map(([tier, names]) => ({
		weight: TIER_WEIGHTS[tier] ?? 1,
		names,
	}));
	const allNames = [...new Set(Object.values(PLACE_NAME_TIERS).flat())];
	return {
		pick(taken) {
			const available = tiers
				.map((tier) => ({
					weight: tier.weight,
					names: tier.names.filter((name) => !taken.has(name)),
				}))
				.filter((tier) => tier.names.length > 0);
			if (available.length > 0) {
				let roll = random() * available.reduce((sum, tier) => sum + tier.weight, 0);
				for (const [index, tier] of available.entries()) {
					roll -= tier.weight;
					if (roll < 0 || index === available.length - 1) {
						const pick =
							tier.names[Math.min(tier.names.length - 1, Math.floor(random() * tier.names.length))];
						if (pick !== undefined) return pick;
					}
				}
			}
			// Every name is taken: suffix the base until it is free, so `pick` keeps its promise.
			const base =
				allNames[Math.min(allNames.length - 1, Math.floor(random() * allNames.length))] ??
				"workspace";
			let candidate = base;
			for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
			return candidate;
		},
	};
}

/** The app tools a new chat exposes (ui-map 3.9). One home for the create form and the defaults. */
export const FIRST_CHAT_APP_TOOLS = {
	diffComments: true,
	progressUpdates: true,
	setTargetBranch: true,
} as const;

/** Shown when the workspace is made but cannot join the chosen section. */
export const SECTION_PLACEMENT_FAILED_MESSAGE =
	"The workspace was created, but it couldn't be added to the section. You can move it from the sidebar.";

/** Shown when the workspace is made but its first chat cannot be created or sent. */
export const CHAT_CREATION_FAILED_MESSAGE =
	"The workspace was created, but its first message could not be started. You can open it and send the message again.";

/** Shown when the default branch prefix needs a GitHub login that `gh` did not return. */
export const GITHUB_LOGIN_MISSING_MESSAGE =
	"No GitHub login was found, so the new branch has no username prefix.";

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
	if (type === "github_username") {
		return githubLogin === null || githubLogin === "" ? "" : `${githubLogin}/`;
	}
	return "";
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

export interface WorkspaceServiceDeps {
	platform: Pick<Platform, "fs" | "opener">;
	git: GitRunner;
	repos: Pick<Repositories, "repos" | "workspaces" | "sessions" | "sections">;
	placeNames: PlaceNames;
	sessions: WorkspaceSessionsPort;
	/**
	 * RUN-03's port service. The composition root still passes it, but creation picks its block
	 * from the stored workspaces because RUN-03's allocator is not built yet.
	 */
	ports?: { allocateForNewWorkspace(): Promise<Result<number>> };
	/** The repository's effective config, for the remote name. Supplied by the composition root. */
	repoConfig?: (repoId: RepoId) => Promise<Result<RepoConfig>>;
	/** The one default-config rule for a new chat. Supplied by the composition root. */
	defaultConfig?: (workspaceId: WorkspaceId) => Promise<Result<SessionConfig>>;
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

	#createQueue: Promise<void> = Promise.resolve();

	constructor(deps: WorkspaceServiceDeps) {
		this.#deps = deps;
		this.store = createStore<WorkspaceState>(() => ({
			loaded: false,
			workspacesById: {},
			setup: {},
			archiving: {},
			warnings: {},
			failedFirstInputs: {},
			lastFailedCreate: null,
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
	create(input: NewWorkspaceInput): Promise<Result<Workspace>> {
		// Creates pick a folder name, branch and port from one read. Running them one at a time
		// keeps two clicks from choosing the same values before either row exists.
		const run = this.#createQueue.then(() => this.#createNow(input));
		this.#createQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async #createNow(input: NewWorkspaceInput): Promise<Result<Workspace>> {
		const found = await this.#deps.repos.repos.get(input.repoId);
		if (!found.ok) return found;
		const repo = found.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const target = baseBranchFor(repo.defaultBranch, input.from);
		if (!target.ok) return target;
		const remote = await this.#remoteFor(repo);

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

		const warnings: string[] = [];
		const prefixType = this.#deps.setting<string>("branch_prefix_type");
		const login = prefixType === "github_username" ? await this.#githubLogin(repo.rootPath) : null;
		if (prefixType === "github_username" && login === null) {
			warnings.push(GITHUB_LOGIN_MISSING_MESSAGE);
		}
		const prefix = branchPrefixFor(
			prefixType,
			this.#deps.setting<string>("branch_prefix_custom"),
			login,
		);
		const branch = await nextFreeName(`${prefix}${folder.value}`, (candidate) =>
			branchNameIsTaken(this.#deps.git, {
				repoRootPath: repo.rootPath,
				remote,
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
		const wantsChat = input.prompt.trim() !== "" || input.attachmentPaths.length > 0;
		if (wantsChat) this.#rememberFirstInput(row.value.id, input);

		const materialised = await this.#materialise(row.value, repo, remote);
		if (!materialised.ok) {
			this.#addWarnings(row.value.id, warnings);
			return materialised;
		}
		this.#addWarnings(row.value.id, [...warnings, ...materialised.value.warnings]);

		await this.#placeInSection(materialised.value.workspace, input.sectionId);

		if (wantsChat) {
			const chatInput = await this.#firstChatInput(materialised.value.workspace.id, input);
			const chat = await this.#deps.sessions.createFirstChat(
				materialised.value.workspace.id,
				chatInput,
			);
			if (chat.ok) this.#forgetFirstInput(materialised.value.workspace.id);
			else this.#addWarnings(materialised.value.workspace.id, [CHAT_CREATION_FAILED_MESSAGE]);
		} else {
			this.#forgetFirstInput(materialised.value.workspace.id);
		}
		return ok(materialised.value.workspace);
	}

	/**
	 * The git work a created or retried workspace needs: the worktree when the folder is missing,
	 * then the worktree config, then the move to ready. Both `create` and `retrySetup` use it.
	 */
	async #materialise(
		workspace: Workspace,
		repo: Repo,
		remote: string,
	): Promise<Result<{ workspace: Workspace; warnings: string[] }>> {
		const warnings: string[] = [];
		const exists = await this.#deps.platform.fs.exists(workspace.path);
		if (!exists) {
			const created = await createWorktree(this.#deps.git, {
				repoRootPath: repo.rootPath,
				remote,
				baseBranch: workspace.targetBranch,
				newBranch: workspace.branch,
				worktreePath: workspace.path,
				allowLocalBase: repo.remoteUrl === null,
			});
			if (!created.ok) return this.#fail(workspace, created.error);
			if (created.value.warning !== null) warnings.push(created.value.warning);
		}

		const prepared = await prepareWorktree(this.#deps.git, {
			repoRootPath: repo.rootPath,
			worktreePath: workspace.path,
			autoSetupUpstream: this.#deps.setting<boolean>("worktree_push_auto_setup_remote"),
			fs: this.#deps.platform.fs,
		});
		if (!prepared.ok) return this.#fail(workspace, prepared.error);
		if (prepared.value.warning !== null) warnings.push(prepared.value.warning);

		const moved = await this.#deps.repos.workspaces.transitionState(
			workspace.id,
			"initializing",
			"ready",
		);
		if (!moved.ok) return this.#fail(workspace, moved.error);
		const ready: Workspace = { ...workspace, state: "ready", updatedAt: this.#deps.now() };
		this.#upsert(ready);
		return ok({ workspace: ready, warnings });
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
		const initializing = { ...workspace, state: "initializing" as const };
		this.#upsert({ ...initializing, updatedAt: this.#deps.now() });

		const remote = await this.#remoteFor(repo);
		const materialised = await this.#materialise(initializing, repo, remote);
		if (!materialised.ok) return materialised;
		this.#addWarnings(id, materialised.value.warnings);

		// A failed creation kept its first message, so a successful retry can start the chat.
		const firstInput = this.store.getState().failedFirstInputs?.[id];
		if (firstInput !== undefined) {
			const chatInput = await this.#firstChatInput(id, firstInput);
			const chat = await this.#deps.sessions.createFirstChat(id, chatInput);
			if (chat.ok) this.#forgetFirstInput(id);
			else this.#addWarnings(id, [CHAT_CREATION_FAILED_MESSAGE]);
		}
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

	/** Keeps the first message while a creation can still fail, so Retry and Recover have it. */
	#rememberFirstInput(id: WorkspaceId, input: NewWorkspaceInput): void {
		this.store.setState((state) => ({
			...state,
			failedFirstInputs: { ...(state.failedFirstInputs ?? {}), [id]: input },
		}));
	}

	#forgetFirstInput(id: WorkspaceId): void {
		this.store.setState((state) => {
			const failedFirstInputs = { ...(state.failedFirstInputs ?? {}) };
			delete failedFirstInputs[id];
			return { ...state, failedFirstInputs };
		});
	}

	/** Adds warnings the create page toasts once the action returns. */
	#addWarnings(id: WorkspaceId, warnings: readonly string[]): void {
		if (warnings.length === 0) return;
		this.store.setState((state) => ({
			...state,
			warnings: {
				...(state.warnings ?? {}),
				[id]: [...(state.warnings?.[id] ?? []), ...warnings],
			},
		}));
	}

	/**
	 * The remote the repository's config picks, or "origin" when the config is empty or cannot be
	 * read (ui-map 6 Git, services-map 3.1).
	 */
	async #remoteFor(repo: Repo): Promise<string> {
		const configured =
			this.#deps.repoConfig === undefined ? null : await this.#deps.repoConfig(repo.id);
		if (configured?.ok === true) {
			const name = configured.value.remoteName?.trim() ?? "";
			if (name !== "") return name;
		}
		return "origin";
	}

	/**
	 * The first chat's config: the app's one default-config rule, with the user's model and plan
	 * mode changes on top. Without the injected rule the page's config stands.
	 */
	async #firstChatInput(
		workspaceId: WorkspaceId,
		input: NewWorkspaceInput,
	): Promise<NewWorkspaceInput> {
		const defaults =
			this.#deps.defaultConfig === undefined ? null : await this.#deps.defaultConfig(workspaceId);
		if (defaults === null || !defaults.ok) return input;
		const requested = input.config;
		const config: SessionConfig = {
			...defaults.value,
			model: requested.model.trim() === "" ? defaults.value.model : requested.model.trim(),
			planMode: requested.planMode,
		};
		return { ...input, config };
	}

	/** Puts a new workspace in the chosen section, and warns when that fails (ui-map 7.2). */
	async #placeInSection(workspace: Workspace, sectionId: SectionId | null): Promise<void> {
		if (sectionId === null) return;
		const placed = await this.#deps.repos.sections.moveWorkspace(workspace.id, sectionId);
		if (!placed.ok) this.#addWarnings(workspace.id, [SECTION_PLACEMENT_FAILED_MESSAGE]);
	}

	/** Moves a half-created workspace to failed and keeps its row (D034). */
	async #fail(workspace: Workspace, error: AppError): Promise<Result<never>> {
		const moved = await this.#deps.repos.workspaces.transitionState(
			workspace.id,
			"initializing",
			"failed",
		);
		const failed: Workspace = {
			...workspace,
			state: "failed",
			updatedAt: this.#deps.now(),
		};
		if (moved.ok && moved.value) this.#upsert(failed);
		this.store.setState((state) => ({ ...state, lastFailedCreate: failed }));
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
