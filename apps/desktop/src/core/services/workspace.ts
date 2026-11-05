/**
 * @feature WS-01 Workspace service: create, set up, archive, unarchive, delete
 * Owns: the list of workspaces and their lifecycle as far as it is built: creating a worktree and
 * its first chat, running the setup script, and storing the intended target branch (GIT-08).
 * Behaviour: frontend.md 6 (creation, naming, setup, archive), services-map.md 2.4.1 (state
 * machine), 3.1 (create), 3.2 and 5A.1.2 (setup), 3.10 (archive and unarchive), 3.11 (branch
 * rename and the stored target branch), ui-map.md 3.9 and 3.1.
 * Must handle: state moves initializing -> ready (or failed), each guarded so a stale step cannot
 * move a workspace that already changed; the directory name is a unique place name for the repo
 * and the branch is prefix + name, suffixed -v1, -v2 when taken; a branch, prefix or remote name
 * that git could read as an option or refuses is rejected before any git call; creation fetches
 * the base, falls back to the cached remote ref offline and tells the user; copying the repo's
 * files (for example `.env`) is part of creation and never overwrites a file already in the
 * worktree; setup runs in a terminal with the workspace variables and its result decides ready or
 * failed (a failed setup keeps the workspace, with a retry; a second retry while one runs is
 * ignored); creations run one at a time; a repo config or default-config read that fails is shown
 * as a warning, never hidden.
 * Not built yet (placeholders): archive, unarchive, delete to the Trash, the branch auto rename,
 * `markRead`, pinning and the base from a pull request or issue. `classifyUnarchive` is their
 * decision rule and has no caller until WS-06.
 * Our design choice: creation is split in two so the sidebar shows the workspace at once
 * (`initializing`) and the slow git work happens after the row exists. Place names come from our
 * own tiered source in this file (`createPlaceNames`, D002), which the composition root should
 * pass in place of any other list. Creation copies the repository's included files, counts the
 * worktree files, then runs setup in a terminal. Warnings and the first message of a failed
 * creation live in the service's in-memory store: the contract's `Workspace` row has no field for
 * them, and the create page reads them back after the action returns. Calls to `repoConfig` and
 * `defaultConfig` are optional because the composition root passes them in a later wiring change.
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
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import { globToRegExp } from "../../platform/glob.ts";
import type { Platform } from "../../platform/platform.ts";
import type { Draft, NewWorkspaceInput, UnarchiveOutcome } from "../api.ts";
import { setupLogFile } from "../app-paths.ts";
import { createKeyedQueue } from "../async/serial-queue.ts";
import type { Repositories } from "../db/repositories.ts";
import { lsFiles, lsFilesIgnoredNul } from "../git/commands.ts";
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
import type { SetupRunResult } from "./run-scripts.ts";

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

/** Files copied into a new worktree when the repository config names none (services-map 5A.5.5). */
export const DEFAULT_COPY_FILES: readonly string[] = [".env*"];

/** The largest file copied into a new worktree (256 KiB, services-map 5A.5.5). */
export const COPY_FILE_SIZE_LIMIT = 256 * 1024;

/** The patterns in a `.worktreeinclude` file, one per line, ignoring blank lines and comments. */
export function parseWorktreeInclude(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
}

const hasGlob = (pattern: string): boolean => /[*?]/.test(pattern);

/** True when a worktree-relative path matches one copy pattern. */
export function matchesCopyPattern(path: string, pattern: string): boolean {
	const trimmed = pattern
		.trim()
		.replace(/^!+/, "")
		.replace(/^\.?\//, "");
	if (trimmed === "") return false;
	const normalized = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
	if (normalized === "") return false;
	if (hasGlob(normalized)) return globToRegExp(normalized).test(path);
	return path === normalized || path.startsWith(`${normalized}/`);
}

/** The ignored files a repository asks to copy, in pattern order, with `!` removing matches. */
export function selectIncludedPaths(
	paths: readonly string[],
	patterns: readonly string[],
): string[] {
	const selected = new Set<string>();
	for (const raw of patterns) {
		const pattern = raw.trim();
		if (pattern === "") continue;
		const negated = pattern.startsWith("!");
		for (const path of paths) {
			if (!matchesCopyPattern(path, pattern)) continue;
			if (negated) selected.delete(path);
			else selected.add(path);
		}
	}
	return [...selected];
}

export interface CopyIncludedFilesDeps {
	fs: Pick<Platform["fs"], "readText" | "exists" | "stat" | "mkdirp" | "readDir">;
	shell: Pick<Platform["shell"], "run">;
	git: GitRunner;
	repoConfig?: (repoId: RepoId) => Promise<Result<RepoConfig>>;
}

/**
 * Copies the files the repository asks for into a new worktree: the lines of `.worktreeinclude`
 * plus the repository's `file_include_globs` (default `.env*`), each file up to 256 KiB
 * (services-map.md 3.1, 5A.5.5). Every path it could not copy comes back as a warning, so the
 * create page can tell the user rather than dropping it silently.
 */
export async function copyIncludedFiles(
	deps: CopyIncludedFilesDeps,
	repo: Repo,
	workspace: Workspace,
): Promise<Result<string[]>> {
	const warnings: string[] = [];
	let fromSettings: readonly string[] = DEFAULT_COPY_FILES;
	if (deps.repoConfig !== undefined) {
		const configured = await deps.repoConfig(repo.id);
		if (!configured.ok) {
			warnings.push(`Couldn't read the repository's file list: ${configured.error.message}`);
		} else if (Array.isArray(configured.value.copyFiles)) {
			fromSettings = configured.value.copyFiles;
		}
	}

	const includePath = `${repo.rootPath}/.worktreeinclude`;
	let fromFile: string[] = [];
	if (await deps.fs.exists(includePath)) {
		const include = await deps.fs.readText(includePath);
		if (include.ok) fromFile = parseWorktreeInclude(include.value);
		else warnings.push(`Couldn't read .worktreeinclude: ${include.error.message}`);
	}

	const patterns = [...fromSettings, ...fromFile];
	if (patterns.length === 0) return ok(warnings);

	const listed = await deps.git.run(lsFilesIgnoredNul(), { cwd: repo.rootPath });
	if (!listed.ok) return listed;
	const candidates = listed.value.stdout.split("\0").filter((path) => path !== "");
	const selected = selectIncludedPaths(candidates, patterns);

	for (const path of selected) {
		const source = `${repo.rootPath}/${path}`;
		const target = `${workspace.path}/${path}`;
		const stat = await deps.fs.stat(source);
		if (!stat.ok) {
			warnings.push(`Couldn't copy ${path}: ${stat.error.message}`);
			continue;
		}
		const copied = stat.value.isDirectory
			? await copyDirectory(deps, source, target, path, warnings)
			: await copyFile(deps, source, target, path, stat.value.size, warnings);
		if (!copied.ok) return copied;
	}
	return ok(warnings);
}

/** Copies one included file with its mode, or records why it was skipped. */
async function copyFile(
	deps: CopyIncludedFilesDeps,
	source: string,
	target: string,
	displayPath: string,
	size: number,
	warnings: string[],
): Promise<Result<void>> {
	if (size > COPY_FILE_SIZE_LIMIT) {
		warnings.push(`Skipped ${displayPath}: larger than 256 KiB.`);
		return ok(undefined);
	}
	// A file already in the worktree may hold the user's edits (a retry runs this copy again).
	if (await deps.fs.exists(target)) return ok(undefined);
	const parent = target.slice(0, target.lastIndexOf("/"));
	const made = await deps.fs.mkdirp(parent);
	if (!made.ok) return made;
	const copied = await deps.shell.run({ program: "cp", args: ["-p", source, target], cwd: parent });
	if (!copied.ok) return copied;
	if (copied.value.exitCode !== 0) {
		warnings.push(`Couldn't copy ${displayPath}: ${copied.value.stderr.trim() || "cp failed"}`);
	}
	return ok(undefined);
}

/** Copies a whole included folder, keeping each file's mode and the 256 KiB cap. */
async function copyDirectory(
	deps: CopyIncludedFilesDeps,
	source: string,
	target: string,
	displayPath: string,
	warnings: string[],
): Promise<Result<void>> {
	const listed = await deps.fs.readDir(source);
	if (!listed.ok) {
		warnings.push(`Couldn't read ${displayPath}: ${listed.error.message}`);
		return ok(undefined);
	}
	const made = await deps.fs.mkdirp(target);
	if (!made.ok) return made;
	for (const entry of listed.value) {
		const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
		const childDisplay = `${displayPath.replace(/\/$/, "")}/${name}`;
		const childSource = `${source.replace(/\/$/, "")}/${name}`;
		const childTarget = `${target.replace(/\/$/, "")}/${name}`;
		const copied = entry.isDirectory
			? await copyDirectory(deps, childSource, childTarget, childDisplay, warnings)
			: await copyFile(deps, childSource, childTarget, childDisplay, entry.size, warnings);
		if (!copied.ok) return copied;
	}
	return ok(undefined);
}

/**
 * True when git accepts `name` as a branch name (or a remote name) and no git or gh command can
 * read it as an option. A name that starts with `-` is refused for that reason.
 */
export function isSafeRefName(name: string): boolean {
	if (name === "" || name === "@" || name.startsWith("-") || name.startsWith("/")) return false;
	if (name.endsWith("/") || name.endsWith(".") || name.includes("..") || name.includes("//")) {
		return false;
	}
	if (name.includes("@{")) return false;
	for (const char of name) {
		const code = char.charCodeAt(0);
		if (code <= 0x20 || code === 0x7f || "~^:?*[\\".includes(char)) return false;
	}
	return !name.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"));
}

/** The message for a branch, prefix or remote name that git would refuse. */
export const invalidRefNameError = (name: string): AppError =>
	appError(
		"workspace_branch_invalid",
		`"${name}" can't be used as a Git branch or remote name. Check the branch prefix in settings.`,
	);

/** Resolves `NewWorkspaceInput.from` to the branch the worktree starts from. */
export function baseBranchFor(
	defaultBranch: string,
	from: NewWorkspaceInput["from"],
): Result<string> {
	if (from.kind === "default") return ok(defaultBranch);
	if (from.kind === "branch") {
		const name = from.name.trim();
		if (name === "")
			return err(appError("workspace_base_missing", "Choose the branch to start from."));
		return isSafeRefName(name) ? ok(name) : err(invalidRefNameError(name));
	}
	return err(
		appError(
			"workspace_base_unsupported",
			"Creating a workspace from a pull request or issue is not built yet.",
		),
	);
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

/** The words for a setup script that failed (inventory:toast main row 463). */
export const SETUP_FAILED_MESSAGE = "Setup script failed. Check the setup tab for logs.";

/** Shown when a saved setup transcript cannot be read (ui-map.md 3.7). */
export const SETUP_LOG_MISSING_MESSAGE = "No logs were recorded, or they have expired.";

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
	workspacesById: Readonly<Record<string, Workspace>>;
	/** In memory only: the setup script's state per workspace. */
	setup: Readonly<Record<string, SetupState>>;
	/** In memory only: the last setup run of each workspace, for the Setup tab. */
	setupRuns?: Readonly<Record<string, SetupRun>>;
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
	platform: Pick<Platform, "fs" | "opener" | "shell">;
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
		runSetup(
			workspaceId: WorkspaceId,
			onStarted?: (terminalId: TerminalId) => void,
		): Promise<Result<SetupRunResult>>;
		runArchive(workspaceId: WorkspaceId): Promise<Result<void>>;
		stopWorkspace(workspaceId: WorkspaceId): Promise<Result<void>>;
	};
	setting: <T>(key: string) => T;
	now: () => number;
}

export class WorkspaceService {
	readonly store: StoreApi<WorkspaceState>;
	readonly #deps: WorkspaceServiceDeps;

	/** Creates pick a folder name, branch and port from one read, so they run one at a time. */
	readonly #createQueue = createKeyedQueue();
	/** Bumped by every start and cancel, so an older run cannot change the state after them. */
	readonly #setupNonces = new Map<WorkspaceId, number>();
	/** The nonce of a start that has not reached its first await yet, so a second one is ignored. */
	readonly #setupStarting = new Map<WorkspaceId, number>();

	constructor(deps: WorkspaceServiceDeps) {
		this.#deps = deps;
		this.store = createStore<WorkspaceState>(() => ({
			loaded: false,
			workspacesById: {},
			setup: {},
			setupRuns: {},
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
		const setupRuns: Record<string, SetupRun> = {};
		let logError: AppError | null = null;
		for (const workspace of listed.value) {
			workspacesById[workspace.id] = workspace;
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
		this.store.setState((state) => ({
			...state,
			loaded: true,
			workspacesById,
			setupRuns,
		}));
		return logError === null ? ok(undefined) : err(logError);
	}

	/** Backs `Actions.workspaces.create`: row first, then worktree, setup, and the first chat. */
	create(input: NewWorkspaceInput): Promise<Result<Workspace>> {
		// Running creates one at a time keeps two clicks from choosing the same values before
		// either row exists.
		return this.#createQueue.run("create", () => this.#createNow(input));
	}

	async #createNow(input: NewWorkspaceInput): Promise<Result<Workspace>> {
		const found = await this.#deps.repos.repos.get(input.repoId);
		if (!found.ok) return found;
		const repo = found.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const target = baseBranchFor(repo.defaultBranch, input.from);
		if (!target.ok) return target;
		const remoteRead = await this.#remoteFor(repo);
		if (!remoteRead.ok) return remoteRead;
		const remote = remoteRead.value.name;

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
		if (remoteRead.value.warning !== null) warnings.push(remoteRead.value.warning);
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
		const branchBase = `${prefix}${folder.value}`;
		if (!isSafeRefName(branchBase)) return err(invalidRefNameError(branchBase));
		const branch = await nextFreeName(branchBase, (candidate) =>
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
			await this.#startFirstChat(materialised.value.workspace.id, input);
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

		const copied = await copyIncludedFiles(
			{
				fs: this.#deps.platform.fs,
				shell: this.#deps.platform.shell,
				git: this.#deps.git,
				repoConfig: this.#deps.repoConfig,
			},
			repo,
			workspace,
		);
		if (!copied.ok) return this.#fail(workspace, copied.error);
		warnings.push(...copied.value);

		const counted = await this.#countWorktreeFiles(workspace);
		if (!counted.ok) return this.#fail(workspace, counted.error);

		const setup = await this.runSetup(workspace.id);
		if (!setup.ok) return this.#fail(workspace, setup.error);

		const final = await this.#deps.repos.workspaces.get(workspace.id);
		if (!final.ok) return this.#fail(workspace, final.error);
		if (final.value === null) {
			return this.#fail(
				workspace,
				appError("workspace_unknown", "That workspace no longer exists."),
			);
		}
		return ok({ workspace: final.value, warnings });
	}

	/** Counts the files in the new worktree with `git ls-files`, for the Setup tab (3.1). */
	async #countWorktreeFiles(workspace: Workspace): Promise<Result<void>> {
		const listed = await this.#deps.git.run(lsFiles(), { cwd: workspace.path });
		if (!listed.ok) return listed;
		const count = listed.value.stdout.split("\n").filter((line) => line !== "").length;
		const written = await this.#deps.repos.workspaces.setFilesCopied(workspace.id, count);
		if (!written.ok) return written;
		this.#upsert({ ...workspace, filesCopied: count, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Resolves `NewWorkspaceInput.from` (default, branch, pull request, issue) to a base commit. */
	resolveBase(
		_repoId: RepoId,
		_from: NewWorkspaceInput["from"],
	): Promise<Result<{ baseSha: string; branchName: string | null }>> {
		return notImplemented("WS-02");
	}

	/** Runs the repo's setup script in a terminal and moves the workspace to ready or failed. */
	async runSetup(workspaceId: WorkspaceId): Promise<Result<void>> {
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
			if (workspace.state === "archived" || workspace.state === "archiving") {
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

		const remote = await this.#remoteFor(repo);
		if (!remote.ok) return this.#fail(initializing, remote.error);
		const materialised = await this.#materialise(initializing, repo, remote.value.name);
		if (!materialised.ok) return materialised;
		this.#addWarnings(id, [
			...(remote.value.warning === null ? [] : [remote.value.warning]),
			...materialised.value.warnings,
		]);

		// A failed creation kept its first message, so a successful retry can start the chat.
		const firstInput = this.store.getState().failedFirstInputs?.[id];
		if (firstInput !== undefined) await this.#startFirstChat(id, firstInput);
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
	 * The remote the repository's config picks, or "origin" when the config names none
	 * (ui-map 6 Git, services-map 3.1). A config that cannot be read still gives "origin", with a
	 * warning that says so. A configured name git would refuse is an error.
	 */
	async #remoteFor(repo: Repo): Promise<Result<{ name: string; warning: string | null }>> {
		const configured =
			this.#deps.repoConfig === undefined ? null : await this.#deps.repoConfig(repo.id);
		if (configured === null) return ok({ name: "origin", warning: null });
		if (!configured.ok) {
			return ok({
				name: "origin",
				warning: `Couldn't read the repository's settings, so the remote "origin" is used: ${configured.error.message}`,
			});
		}
		const name = configured.value.remoteName?.trim() ?? "";
		if (name === "") return ok({ name: "origin", warning: null });
		return isSafeRefName(name) ? ok({ name, warning: null }) : err(invalidRefNameError(name));
	}

	/**
	 * Starts the first chat. The first message is forgotten only when the chat exists; any failure
	 * leaves it for Retry and Recover and adds a warning for the page.
	 */
	async #startFirstChat(workspaceId: WorkspaceId, input: NewWorkspaceInput): Promise<void> {
		const chatInput = await this.#firstChatInput(workspaceId, input);
		if (!chatInput.ok) {
			this.#addWarnings(workspaceId, [CHAT_CREATION_FAILED_MESSAGE]);
			return;
		}
		const chat = await this.#deps.sessions.createFirstChat(workspaceId, chatInput.value);
		if (chat.ok) this.#forgetFirstInput(workspaceId);
		else this.#addWarnings(workspaceId, [CHAT_CREATION_FAILED_MESSAGE]);
	}

	/**
	 * The first chat's config: the app's one default-config rule, with the user's model and plan
	 * mode changes on top. Without the injected rule the page's config stands. When the rule
	 * cannot be read the chat is not started with a guessed config.
	 */
	async #firstChatInput(
		workspaceId: WorkspaceId,
		input: NewWorkspaceInput,
	): Promise<Result<NewWorkspaceInput>> {
		if (this.#deps.defaultConfig === undefined) return ok(input);
		const defaults = await this.#deps.defaultConfig(workspaceId);
		if (!defaults.ok) return defaults;
		const requested = input.config;
		const config: SessionConfig = {
			...defaults.value,
			model: requested.model.trim() === "" ? defaults.value.model : requested.model.trim(),
			planMode: requested.planMode,
		};
		return ok({ ...input, config });
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
