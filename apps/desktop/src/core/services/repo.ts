/**
 * @feature PRJ-01 Projects (repositories): add and list from a local folder, remove
 * @feature PRJ-03 Quick start a new project from a template
 * Owns: the list of repositories, adding one from a local folder, cloning one from GitHub or any
 * git URL (PRJ-02), removing one, and hiding one from the sidebar. Also owns PRJ-04's config
 * reads: scripts, files to copy and prompts come from `.conducted/settings.toml`, with
 * `.conducted/settings.local.toml` overriding it. Also owns Quick start: creating a project from
 * one of the three templates and creating its private GitHub repository (PRJ-03). Also owns the
 * repository icon (PRJ-05): validating and copying an uploaded image, saving an emoji, and clearing
 * the icon back to its fallback. An upload is copied to a new file in the icons folder
 * (`<repoId>-<uuid>.<ext>`), the database then points to it, and only then is the earlier upload
 * trashed; a failed write trashes the new copy and keeps the old icon. Clearing or replacing an
 * icon, or removing its project, trashes the uploaded file. The web view is given the icons
 * folder (at start) and the one picked file (to read its size), never the folder it came from.
 * Behaviour: ui-map.md 3.9 (add project, Create project), 4 item 8 (Add project menu),
 * services-map.md 3.2 (add repository steps: `git init` when missing, remote URL read and
 * normalised, default branch detection; the create-a-new-GitHub-repo flow), 2.3.2 (repo
 * operations), 1.4 (config group), 4.2 (the repo settings file), 2.5.2 (reload on focus),
 * frontend.md 6 (scripts config in settings.toml).
 * Must handle: a folder that is not a git repository (offer `git init`, never silently); a folder
 * inside an existing repository (ask git for the work tree root, so no nested repository is made);
 * a path already added (return the existing project); a folder added from disk with no commits
 * (workspace creation makes its first commit); creating the GitHub repository makes a first commit
 * of only .gitkeep when the folder is empty and has none, and refuses a folder with files but no
 * commits, so nothing the user did not choose is published; a failure after the repository was
 * created removes the origin gh added before the old origin is put back; the default branch comes
 * from the remote's
 * HEAD, else the checked-out branch, and the add fails visibly when neither exists; removing a
 * project asks its removal port to stop work and delete its workspaces before deleting the row;
 * an invalid settings file is reported instead of replaced; a config edit made outside the app is
 * read again when the window regains focus; only the newest load may change the store, and a
 * read that ends after its project was removed changes nothing; the file commands reach a folder
 * outside `~/conducted` only once it is registered (PLAT-02), so a start registers every saved
 * project's folder, an add registers the picked folder and its work tree root before reading
 * them, and a clone or Quick start registers the folder chosen to hold the new project.
 * Our design choice: `RepoConfig` is the shared file overlaid by the local file. The shared file
 * stays committed and read-only in the UI; `updateConfig` writes the local file only, through the
 * settings service's `updateSettingsFile` (which keeps the file's comments, SET-14), and writes a
 * key only when it differs from the shared value. A key that matches is removed, so a later edit
 * to the shared file reaches the user again.
 * Gaps against services-map.md 4.2: the remote default-branch copy of `settings.toml` and the
 * workspace-level shared file are not read. Keeping `settings.local.toml` out of git is DATA-05's;
 * linking it into every worktree is WS-01's.
 * Also owns the per-user hidden run action ids (SET-07, services-map.md 5A.1.6): they live in
 * local storage, never in a settings file.
 * Test first: the repo's scripts, prompts, globs and run mode are read from
 * `.conducted/settings.toml`.
 * PRJ-03 test first: an empty template creates its folder, first commit and project row.
 * PRJ-05 test first: an uploaded PNG is copied into app storage and saved as a file icon.
 */
import {
	type AppError,
	appError,
	err,
	type IdSource,
	ok,
	type RepoId,
	type Result,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import { appDataPath, localSettingsFile, sharedSettingsFile } from "../app-paths.ts";
import type { Repositories } from "../db/repositories.ts";
import { copyFileKeepingMode, trashIfPresent } from "../fs-helpers.ts";
import {
	addAll,
	addPath,
	branchShowCurrent,
	checkout,
	cloneWithProgress,
	commitAll,
	initRepository,
	pushSetUpstreamHeadWithGh,
	remoteGetUrl,
	remoteRemove,
	remoteRename,
	remoteSetUrl,
	revParse,
	revParseVerify,
	statusPorcelainAll,
	symbolicRefRemoteHead,
} from "../git/commands.ts";
import { githubRepoClone, githubRepoCreate, githubRepoUrl } from "../git/gh-commands.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo, RepoConfig, RepoIconChoice, RunAction } from "../model.ts";
import { coerceSettingValue, getSettingDef, type SettingValue } from "../registries/settings.ts";
import { emojiIconValue, fileIconPath, fileIconValue } from "../repo-icon-value.ts";
import { isGithubRemoteUrl } from "./github.ts";
import {
	GSTACK_TEMPLATE_URL,
	isProjectTemplate,
	type ProjectTemplate,
	projectFolderName,
} from "./project-templates.ts";
import {
	actionIdsEqual,
	actionLabel,
	type DroppedSetting,
	mergeSettingActions,
	type SettingAction,
	type SettingsFileContents,
	type SettingsService,
} from "./settings.ts";

/** What the clone dialog shows while a repository is cloned and after it ends. */
export interface CloneProgress {
	state: "cloning" | "done" | "failed";
	url: string;
	destination: string;
	/** The progress text git printed, or the failure the clone ended with. */
	output: string;
}

export interface RepoState {
	loaded: boolean;
	/** The clone in progress or the one just finished, so the dialog can show its progress. */
	cloneProgress?: CloneProgress | null;
	reposById: Readonly<Record<string, Repo>>;
	/** Ids in sidebar order. Hidden repositories are not listed. */
	order: readonly RepoId[];
	configs: Readonly<Record<string, RepoConfig>>;
	/** Set when a config read failed, so the settings page can show the file's error. */
	configErrors?: Readonly<Record<string, AppError>>;
	/** Values a config file held but the registry could not use, reported like a file read. */
	configDropped?: Readonly<Record<string, readonly DroppedSetting[]>>;
	/** Set when `start` could not read the table, so the sidebar can show its error state. */
	error?: AppError | null;
}

/** Removes a trailing slash so `/code/app` and `/code/app/` are the same folder. */
export function normaliseRootPath(path: string): string {
	const trimmed = path.trim();
	return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

/** Trims a remote URL and removes a trailing slash so the saved value is stable. */
export function normaliseRemoteUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

/** The local storage key that holds the shared run actions this user hid for one repository. */
export const hiddenRunActionsStorageKey = (repoId: RepoId): string =>
	`conducted.hidden-run-actions:${repoId}`;

/** Local storage is the home for per-user hidden actions, not any settings file. */
function hiddenRunActionsStorage(): Result<Storage> {
	if (typeof globalThis.localStorage === "undefined") {
		return err(
			appError("local_storage_unavailable", "Hidden actions can't be read in this environment."),
		);
	}
	try {
		return ok(globalThis.localStorage);
	} catch (cause) {
		return err(
			appError(
				"local_storage_unavailable",
				"Hidden actions can't be read in this environment.",
				cause,
			),
		);
	}
}

/** Reads the ids of the shared run actions this user hid for one repository. */
export function readHiddenRunActions(repoId: RepoId): Result<readonly string[]> {
	const store = hiddenRunActionsStorage();
	if (!store.ok) return store;
	let raw: string | null;
	try {
		raw = store.value.getItem(hiddenRunActionsStorageKey(repoId));
	} catch (cause) {
		return err(
			appError("local_storage_unavailable", "Hidden actions can't be read on this Mac.", cause),
		);
	}
	if (raw === null) return ok([]);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		return err(
			appError("hidden_actions_invalid", "The saved hidden actions are not readable.", cause),
		);
	}
	if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
		return err(appError("hidden_actions_invalid", "The saved hidden actions are not readable."));
	}
	return ok(parsed);
}

/** Saves the ids of the shared run actions this user hid for one repository. */
export function writeHiddenRunActions(repoId: RepoId, actionIds: readonly string[]): Result<void> {
	const store = hiddenRunActionsStorage();
	if (!store.ok) return store;
	try {
		store.value.setItem(hiddenRunActionsStorageKey(repoId), JSON.stringify(actionIds));
	} catch (cause) {
		return err(
			appError("local_storage_unavailable", "Hidden actions can't be saved on this Mac.", cause),
		);
	}
	return ok(undefined);
}

/** Forgets the shared run actions this user hid for a repository. Its project is gone. */
export function clearHiddenRunActions(repoId: RepoId): Result<void> {
	const store = hiddenRunActionsStorage();
	if (!store.ok) return store;
	try {
		store.value.removeItem(hiddenRunActionsStorageKey(repoId));
	} catch (cause) {
		return err(
			appError("local_storage_unavailable", "Hidden actions can't be cleared on this Mac.", cause),
		);
	}
	return ok(undefined);
}

/** The folder's own name, used as the project name. */
export function projectNameFromPath(path: string): string {
	const trimmed = normaliseRootPath(path);
	const parts = trimmed.split("/");
	return parts.at(-1) || trimmed || "Project";
}

/**
 * The folder a clone of this URL makes: the last path segment without `.git`. Both the HTTPS form
 * and git's `user@host:owner/repo` form name the same folder. Null when the URL names no folder.
 */
export function repoNameFromUrl(url: string): string | null {
	const trimmed = url.trim().replace(/\/+$/, "");
	if (trimmed === "") return null;
	const scp = /^[^@\s/]+@[^:\s/]+:(.+)$/.exec(trimmed);
	let path: string;
	if (scp !== null) {
		path = scp[1] ?? "";
	} else {
		try {
			path = new URL(trimmed).pathname;
		} catch {
			return null;
		}
	}
	const segments = path.split("/").filter((segment) => segment !== "");
	const last = segments.at(-1)?.replace(/\.git$/i, "") ?? "";
	return last === "" ? null : last;
}

/** Joins a parent folder and a child name with a single slash. */
export function joinFolder(parent: string, child: string): string {
	const root = normaliseRootPath(parent);
	return root === "/" ? `/${child}` : `${root}/${child}`;
}

/**
 * The remote's HEAD branch when it has one, otherwise the checked-out branch. Fails when neither
 * exists (a detached HEAD with no remote HEAD), so a workspace never branches from an invented ref.
 * `remoteHead` is the full ref name such as `refs/remotes/origin/main`.
 */
export function defaultBranchFrom(
	remoteHead: string | null,
	current: string | null,
): Result<string> {
	if (remoteHead !== null) {
		const match = /^refs\/remotes\/[^/]+\/(.+)$/.exec(remoteHead);
		if (match?.[1] !== undefined && match[1] !== "") return ok(match[1]);
	}
	if (current !== null && current !== "") return ok(current);
	return err(
		appError(
			"repo_default_branch_unknown",
			"Can't tell which branch to start from: the repository has no remote HEAD and is not on a branch.",
		),
	);
}

/** The image types an uploaded repository icon may be. */
const ICON_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
/** Largest uploaded icon. The message says 10MB; the cut is 10 MiB. */
const MAX_ICON_BYTES = 10 * 1024 * 1024;
const ICON_TYPE_MESSAGE = "Choose a PNG, JPEG, GIF, WebP, or SVG image";
const ICON_SIZE_MESSAGE = "Image is too large. Choose one under 10MB.";
const ICON_FAILED_MESSAGE = "Failed to set the icon. Try a different image.";

/** Where uploaded repository icons live under the app data folder. */
export const repoIconsDir = (paths: Platform["fs"]["paths"]): string => appDataPath(paths, "icons");

/** The lower-case extension of a file name, or null when it has none. */
function iconExtension(path: string): string | null {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? null : name.slice(dot + 1).toLowerCase();
}

/** Called before a repo is removed so running scripts stop and workspaces go. */
export interface RepoRemovalPort {
	removeWorkspacesOf(repoId: RepoId): Promise<Result<void>>;
	/** After the repository row is gone: its backlog drafts now have no repository (WS-11). */
	releaseBacklogOf(repoId: RepoId): void;
}

export interface RepoServiceDeps {
	platform: Pick<Platform, "fs" | "opener" | "dialogs" | "shell"> & {
		window?: Pick<Platform["window"], "onFocusChanged">;
	};
	git: GitRunner;
	repos: Pick<Repositories, "repos" | "settings">;
	settings: Pick<SettingsService, "readSettingsFile" | "updateSettingsFile">;
	removal: RepoRemovalPort;
	/** Names each uploaded icon file, so a new upload never reuses a cached address. */
	ids: Pick<IdSource, "uuid">;
}

/** The value and the file that supplied it: the local file wins over the shared file. */
function winningValue(
	shared: SettingsFileContents,
	local: SettingsFileContents,
	key: string,
): { value: unknown; file: string } {
	return Object.hasOwn(local.values, key)
		? { value: local.values[key], file: local.file }
		: { value: shared.values[key], file: shared.file };
}

/** The registry default, so this file never repeats a value the settings registry already holds. */
function defaultOf(key: string): SettingValue {
	const def = getSettingDef(key);
	if (def === undefined) return null;
	return def.type === "string-list" ? [...def.default] : def.default;
}

/** The reason `readSettingsFile` records for a value the registry cannot use. */
function droppedReason(message: string): DroppedSetting["reason"] {
	return message.includes("must be one of") ? "unsupported-value" : "wrong-type";
}

/**
 * Reads one key from the two files and checks it against the registry. A value the registry cannot
 * use is recorded and then treated as not set, the way `readSettingsFile` reports dropped entries.
 */
function readConfigValue(
	source: {
		shared: SettingsFileContents;
		local: SettingsFileContents;
		dropped: DroppedSetting[];
	},
	key: string,
): SettingValue | undefined {
	const won = winningValue(source.shared, source.local, key);
	if (won.value === undefined) return undefined;
	const def = getSettingDef(key);
	if (def === undefined) return undefined;
	const coerced = coerceSettingValue(def, won.value);
	if (!coerced.ok) {
		source.dropped.push({
			file: won.file,
			key: def.tomlKey ?? key,
			reason: droppedReason(coerced.error.message),
		});
		return undefined;
	}
	return coerced.value;
}

const asText = (value: SettingValue | undefined): string | null =>
	typeof value === "string" && value !== "" ? value : null;

/** An empty settings file, used to read a file's own effective config. */
function emptyFileContents(file: string): SettingsFileContents {
	return { file, values: {}, actions: {}, envVars: {}, dropped: [], preserved: [] };
}

/** Merges the named actions of the two repo files, noting where each one is defined. */
function runActionsFrom(shared: SettingsFileContents, local: SettingsFileContents): RunAction[] {
	const sharedActions = Object.values(shared.actions);
	const localActions = Object.values(local.actions);
	return mergeSettingActions([sharedActions, localActions]).map((action) => {
		const inLocal = localActions.some((candidate) => actionIdsEqual(candidate.id, action.id));
		const inShared = sharedActions.some((candidate) => actionIdsEqual(candidate.id, action.id));
		return {
			id: action.id,
			label: actionLabel(action.id),
			command: action.command,
			args: [...action.args],
			cwd: action.cwd,
			isDefault: action.isDefault,
			hidden: action.hidden,
			icon: action.icon,
			origin: inLocal ? (inShared ? "changed_locally" : "local") : "shared",
		};
	});
}

export interface RepoConfigRead {
	config: RepoConfig;
	/** Values the registry could not use, in the shape `readSettingsFile` reports them. */
	dropped: DroppedSetting[];
}

/**
 * The effective per-repo config: the shared file, with each value the local file sets winning.
 * Prompts, globs and scripts all come from the same two files, as the settings pages expect.
 */
export function repoConfigFrom(
	shared: SettingsFileContents,
	local: SettingsFileContents,
): RepoConfigRead {
	const source = { shared, local, dropped: [] as DroppedSetting[] };
	const value = (key: string): SettingValue | undefined => readConfigValue(source, key);
	const prompt = (key: string): string | null => asText(value(key));
	const list = (key: string): string[] => {
		const read = value(key);
		return Array.isArray(read) ? [...read] : [...(defaultOf(key) as string[])];
	};
	const flag = (key: string): boolean => {
		const read = value(key);
		return typeof read === "boolean" ? read : (defaultOf(key) as boolean);
	};
	const runMode = (): RepoConfig["runMode"] => {
		const read = value("run_script_mode");
		return read === "exclusive" || read === "concurrent"
			? read
			: (defaultOf("run_script_mode") as RepoConfig["runMode"]);
	};
	return {
		config: {
			setupScript: asText(value("setup_script")),
			runScripts: runActionsFrom(shared, local),
			runMode: runMode(),
			archiveScript: asText(value("archive_script")),
			copyFiles: list("file_include_globs"),
			previewUrlTemplate: list("open_url_template")[0] ?? null,
			spotlightTesting: flag("spotlight_testing"),
			autoRunAfterSetup: flag("auto_run_after_setup"),
			remoteName: asText(value("remote_name")),
			prompts: {
				general: prompt("custom_prompt_general"),
				codeReview: prompt("custom_prompt_code_review"),
				createPr: prompt("custom_prompt_create_pr"),
				fixErrors: prompt("custom_prompt_fix_errors"),
				resolveConflicts: prompt("custom_prompt_resolve_merge_conflicts"),
				renameBranch: prompt("custom_prompt_rename_branch"),
			},
		},
		dropped: source.dropped,
	};
}

/** The settings keys `updateConfig` owns. An older invalid value for them must not survive. */
const REPO_CONFIG_KEYS = [
	"setup_script",
	"run_script",
	"archive_script",
	"run_script_mode",
	"file_include_globs",
	"open_url_template",
	"spotlight_testing",
	"auto_run_after_setup",
	"remote_name",
	"custom_prompt_general",
	"custom_prompt_code_review",
	"custom_prompt_create_pr",
	"custom_prompt_fix_errors",
	"custom_prompt_resolve_merge_conflicts",
	"custom_prompt_rename_branch",
] as const;

/** Drops preserved raw entries under the keys a config write replaces. */
function withoutRepoConfigPreserved(
	preserved: readonly { path: string; value: unknown }[],
): { path: string; value: unknown }[] {
	const keys = REPO_CONFIG_KEYS.flatMap((key) => {
		const tomlKey = getSettingDef(key)?.tomlKey;
		return tomlKey === undefined ? [] : [tomlKey];
	});
	return preserved.filter(
		(entry) => !keys.some((key) => entry.path === key || entry.path.startsWith(`${key}.`)),
	);
}

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((entry, index) => entry === right[index]);

/**
 * Writes a value only when it differs from the shared file. When it matches, the local key is
 * removed so a later edit to the shared file reaches the user again.
 */
function writeIfDifferent(
	contents: SettingsFileContents,
	key: string,
	value: SettingValue,
	shared: SettingValue,
): void {
	if (value === shared) delete contents.values[key];
	else contents.values[key] = value;
}

/** A cleared text value is written as an explicit empty string, so the shared text stays cleared. */
function writeText(
	contents: SettingsFileContents,
	key: string,
	value: string | null,
	shared: string | null,
): void {
	if (value === shared) delete contents.values[key];
	else contents.values[key] = value ?? "";
}

/** A cleared list is written as an explicit empty list, so the shared list stays cleared. */
function writeList(
	contents: SettingsFileContents,
	key: string,
	value: readonly string[],
	shared: readonly string[],
): void {
	if (sameStrings(value, shared)) delete contents.values[key];
	else contents.values[key] = [...value];
}

function actionsMatch(left: RunAction, right: RunAction): boolean {
	return (
		left.command === right.command &&
		sameStrings(left.args, right.args) &&
		left.cwd === right.cwd &&
		left.isDefault === right.isDefault &&
		left.hidden === right.hidden &&
		left.icon === right.icon
	);
}

/**
 * The local action tables an update writes: actions defined locally or changed from a shared one.
 * A change that leaves an action equal to its shared version is left out, so the shared definition
 * keeps winning.
 */
function localActionsFrom(
	actions: readonly RunAction[],
	sharedActions: readonly RunAction[],
): Record<string, SettingAction> {
	const result: Record<string, SettingAction> = {};
	for (const action of actions) {
		if (action.origin === "shared") continue;
		const shared = sharedActions.find((candidate) => actionIdsEqual(candidate.id, action.id));
		if (shared !== undefined && actionsMatch(action, shared)) continue;
		result[action.id] = {
			id: action.id,
			command: action.command,
			args: [...action.args],
			cwd: action.cwd,
			isDefault: action.isDefault,
			hidden: action.hidden,
			icon: action.icon,
		};
	}
	return result;
}

/** The sidebar order: visible repositories by display order, then name and id. */
function visibleOrder(reposById: Readonly<Record<string, Repo>>): readonly RepoId[] {
	return Object.values(reposById)
		.filter((repo) => !repo.hidden)
		.sort(
			(a, b) =>
				a.displayOrder - b.displayOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
		)
		.map((repo) => repo.id);
}

export class RepoService {
	readonly store: StoreApi<RepoState>;
	readonly #deps: RepoServiceDeps;
	/** The newest config load per repository. An older answer may not change the store. */
	readonly #configLoads = new Map<RepoId, number>();
	#unsubscribeFocus: (() => void) | null = null;

	constructor(deps: RepoServiceDeps) {
		this.#deps = deps;
		this.store = createStore<RepoState>(() => ({
			loaded: false,
			cloneProgress: null,
			reposById: {},
			order: [],
			configs: {},
		}));
	}

	async start(): Promise<Result<void>> {
		const listed = await this.#deps.repos.repos.list({ includeHidden: true });
		if (!listed.ok) {
			this.store.setState((state) => ({ ...state, loaded: true, error: listed.error }));
			return err(listed.error);
		}
		// Uploaded icons are shown through the asset protocol, which serves only registered folders.
		const icons = await this.#deps.platform.fs.registerRoot(
			repoIconsDir(this.#deps.platform.fs.paths),
		);
		if (!icons.ok) {
			this.store.setState((state) => ({ ...state, loaded: true, error: icons.error }));
			return icons;
		}
		// The file commands reach a project's folder only once it is registered, on every start.
		for (const repo of listed.value) {
			const registered = await this.#deps.platform.fs.registerRoot(repo.rootPath);
			if (!registered.ok) {
				this.store.setState((state) => ({ ...state, loaded: true, error: registered.error }));
				return registered;
			}
		}
		const reposById: Record<string, Repo> = {};
		for (const repo of listed.value) reposById[repo.id] = repo;
		this.store.setState((state) => ({
			...state,
			loaded: true,
			reposById,
			order: visibleOrder(reposById),
			error: null,
		}));
		return ok(undefined);
	}

	/** Backs `Actions.projects.addLocal`. */
	async addLocal(rawPath: string): Promise<Result<Repo>> {
		const path = normaliseRootPath(rawPath);
		if (path === "") {
			return err(appError("repo_path_missing", "Choose a folder to add."));
		}
		const reachable = await this.#deps.platform.fs.registerRoot(path);
		if (!reachable.ok) return reachable;

		const folder = await this.#deps.platform.fs.stat(path);
		if (!folder.ok) {
			return err(appError("repo_path_missing", `Can't find the folder ${path}.`, folder.error));
		}
		if (!folder.value.isDirectory) {
			return err(appError("repo_not_directory", `${path} is not a folder.`));
		}

		const rootPath = await this.#workTreeRoot(path);
		if (!rootPath.ok) return rootPath;
		// The picked folder can sit inside the repository, whose root is then a parent of it.
		if (rootPath.value !== path) {
			const root = await this.#deps.platform.fs.registerRoot(rootPath.value);
			if (!root.ok) return root;
		}

		return this.#registerFolder(rootPath.value, async () => {
			const remote = await this.#readRemoteUrl(rootPath.value);
			if (!remote.ok) return remote;
			const defaultBranch = await this.#detectDefaultBranch(rootPath.value);
			if (!defaultBranch.ok) return defaultBranch;
			return ok({
				name: projectNameFromPath(rootPath.value),
				remoteUrl: remote.value,
				defaultBranch: defaultBranch.value,
			});
		});
	}

	/**
	 * Adds a folder that is already on disk to the store: answers with the existing row, or reads
	 * what git says about it and creates one. Two adds that race past the lookup share the row the
	 * other stored, so `addLocal` and `clone` register a folder the same way.
	 */
	async #registerFolder(
		rootPath: string,
		details: () => Promise<
			Result<{ name: string; remoteUrl: string | null; defaultBranch: string }>
		>,
	): Promise<Result<Repo>> {
		const existing = await this.#deps.repos.repos.getByRootPath(rootPath);
		if (!existing.ok) return existing;
		if (existing.value !== null) {
			this.#upsert(existing.value);
			return ok(existing.value);
		}

		const values = await details();
		if (!values.ok) return values;
		const created = await this.#deps.repos.repos.create({
			name: values.value.name,
			rootPath,
			remoteUrl: values.value.remoteUrl,
			defaultBranch: values.value.defaultBranch,
			icon: null,
		});
		if (!created.ok) {
			if (created.error.code === "db.conflict") {
				const raced = await this.#deps.repos.repos.getByRootPath(rootPath);
				if (raced.ok && raced.value !== null) {
					this.#upsert(raced.value);
					return ok(raced.value);
				}
			}
			return created;
		}
		this.#upsert(created.value);
		return ok(created.value);
	}

	/**
	 * Backs `Actions.projects.clone`: clones into `<parentDir>/<repository name>` with `gh repo clone`
	 * for a GitHub URL and `git clone --progress` otherwise, checks out the default branch, reads the
	 * remote and adds the project. The store keeps the clone's state and final output for the dialog.
	 */
	async clone(rawUrl: string, rawParentDir: string): Promise<Result<Repo>> {
		const url = normaliseRemoteUrl(rawUrl);
		if (url === "") {
			return err(appError("repo_url_missing", "Enter a repository URL."));
		}
		const parentDir = normaliseRootPath(rawParentDir);
		if (parentDir === "") {
			return err(appError("repo_location_missing", "Choose a folder to clone into."));
		}
		const name = repoNameFromUrl(url);
		if (name === null) {
			return err(appError("repo_url_invalid", "That doesn't look like a Git repository URL."));
		}
		const reachable = await this.#deps.platform.fs.registerRoot(parentDir);
		if (!reachable.ok) return reachable;

		const location = await this.#deps.platform.fs.stat(parentDir);
		if (!location.ok) {
			return err(
				appError("repo_location_missing", `Can't find the folder ${parentDir}.`, location.error),
			);
		}
		if (!location.value.isDirectory) {
			return err(appError("repo_location_missing", `${parentDir} is not a folder.`));
		}

		const destination = joinFolder(parentDir, name);
		const existingFolder = await this.#deps.platform.fs.stat(destination);
		if (existingFolder.ok) {
			return err(
				appError(
					"repo_destination_exists",
					`The folder ${destination} already exists. Choose another location.`,
				),
			);
		}

		this.#setCloneProgress({ state: "cloning", url, destination, output: "" });
		const command = isGithubRemoteUrl(url)
			? githubRepoClone(url, destination)
			: cloneWithProgress(url, destination);
		const cloned = await this.#deps.git.runChecked(command, { cwd: parentDir });
		if (!cloned.ok) {
			this.#setCloneProgress({
				state: "failed",
				url,
				destination,
				output: cloned.error.message,
			});
			return cloned;
		}

		const remote = await this.#readRemoteUrl(destination);
		if (!remote.ok) {
			this.#setCloneProgress({
				state: "failed",
				url,
				destination,
				output: remote.error.message,
			});
			return remote;
		}
		if (remote.value === null) {
			const missing = appError(
				"repo_remote_missing",
				`The clone at ${destination} has no origin remote.`,
			);
			this.#setCloneProgress({
				state: "failed",
				url,
				destination,
				output: missing.message,
			});
			return err(missing);
		}
		const defaultBranch = await this.#detectDefaultBranch(destination);
		if (!defaultBranch.ok) {
			this.#setCloneProgress({
				state: "failed",
				url,
				destination,
				output: defaultBranch.error.message,
			});
			return defaultBranch;
		}

		const current = await this.#deps.git.stdout(branchShowCurrent(), { cwd: destination });
		if (!current.ok) {
			this.#setCloneProgress({
				state: "failed",
				url,
				destination,
				output: current.error.message,
			});
			return current;
		}
		if (current.value !== "" && current.value !== defaultBranch.value) {
			const checkedOut = await this.#deps.git.runChecked(checkout(defaultBranch.value), {
				cwd: destination,
			});
			if (!checkedOut.ok) {
				this.#setCloneProgress({
					state: "failed",
					url,
					destination,
					output: checkedOut.error.message,
				});
				return checkedOut;
			}
		}

		const registered = await this.#registerFolder(destination, async () =>
			ok({ name, remoteUrl: remote.value, defaultBranch: defaultBranch.value }),
		);
		if (!registered.ok) {
			this.#setCloneProgress({
				state: "failed",
				url,
				destination,
				output: registered.error.message,
			});
			return registered;
		}
		this.#setCloneProgress({ state: "done", url, destination, output: "" });
		return ok(registered.value);
	}

	/**
	 * Backs `Actions.projects.createFromTemplate`: makes `<parent>/<slug>`, applies the chosen
	 * template, and adds the folder as a project. A folder this call made is moved to the Trash when
	 * a later step fails, so a failed Quick start leaves nothing behind.
	 */
	async createFromTemplate(
		rawName: string,
		rawParentDir: string,
		template: string,
	): Promise<Result<Repo>> {
		const folder = projectFolderName(rawName);
		if (folder === "") {
			return err(appError("repo_name_invalid", "Project name must include letters or numbers."));
		}
		const parentDir = normaliseRootPath(rawParentDir);
		if (parentDir === "") {
			return err(appError("repo_location_missing", "Choose a folder for the new project."));
		}
		if (!isProjectTemplate(template)) {
			return err(appError("repo_template_unknown", "Choose one of the offered templates."));
		}
		const reachable = await this.#deps.platform.fs.registerRoot(parentDir);
		if (!reachable.ok) return reachable;
		const location = await this.#deps.platform.fs.stat(parentDir);
		if (!location.ok) {
			return err(
				appError("repo_location_missing", `Can't find the folder ${parentDir}.`, location.error),
			);
		}
		if (!location.value.isDirectory) {
			return err(appError("repo_location_missing", `${parentDir} is not a folder.`));
		}

		const destination = joinFolder(parentDir, folder);
		const existing = await this.#deps.platform.fs.stat(destination);
		if (existing.ok) {
			return err(appError("repo_destination_exists", `The folder ${destination} already exists.`));
		}
		const made = await this.#deps.platform.fs.mkdirp(destination);
		if (!made.ok) {
			return err(
				appError("repo_location_missing", `Can't create the folder ${destination}.`, made.error),
			);
		}

		const prepared = await this.#prepareTemplate(parentDir, destination, folder, template);
		if (!prepared.ok) {
			const cleaned = await this.#removeCreatedFolder(destination, prepared.error);
			return cleaned.ok ? prepared : err(cleaned.error);
		}
		const registered = await this.#registerFolder(destination, async () => {
			const remote = await this.#readRemoteUrl(destination);
			if (!remote.ok) return remote;
			const branch = await this.#detectDefaultBranch(destination);
			if (!branch.ok) return branch;
			return ok({ name: folder, remoteUrl: remote.value, defaultBranch: branch.value });
		});
		if (!registered.ok) {
			const cleaned = await this.#removeCreatedFolder(destination, registered.error);
			return cleaned.ok ? registered : err(cleaned.error);
		}
		return registered;
	}

	/** Backs `Actions.projects.remove`. */
	async remove(repoId: RepoId): Promise<Result<void>> {
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}

		const workspaces = await this.#deps.removal.removeWorkspacesOf(repoId);
		if (!workspaces.ok) return workspaces;
		const deleted = await this.#deps.repos.repos.delete(repoId);
		if (!deleted.ok) return deleted;
		// Its backlog drafts stay, with no repository (WS-11).
		this.#deps.removal.releaseBacklogOf(repoId);
		// A config read still running must not put the removed project back in the store.
		this.#nextConfigLoad(repoId);

		const state = this.store.getState();
		const reposById = { ...state.reposById };
		delete reposById[repoId];
		const configs = { ...state.configs };
		delete configs[repoId];
		const configErrors = { ...state.configErrors };
		delete configErrors[repoId];
		const configDropped = { ...state.configDropped };
		delete configDropped[repoId];
		this.store.setState({
			reposById,
			configs,
			configErrors,
			configDropped,
			order: state.order.filter((id) => id !== repoId),
		});
		// The hidden actions of a deleted project have nothing left to hide them for.
		const hiddenCleared = clearHiddenRunActions(repoId);
		if (!hiddenCleared.ok) return hiddenCleared;
		// An uploaded icon belongs to its project and goes to the Trash with it.
		const icon = fileIconPath(found.value.icon);
		if (icon === null) return ok(undefined);
		const trashed = await trashIfPresent(this.#deps.platform.fs, icon);
		return trashed.ok ? ok(undefined) : trashed;
	}

	/**
	 * Reads the shared and local settings files of a repository, overlays them and fills the store.
	 * Backs `useRepoConfig`. A later call wins over an earlier one that finishes late.
	 */
	async loadConfig(repoId: RepoId): Promise<Result<RepoConfig>> {
		this.#ensureConfigReloading();
		const attempt = this.#nextConfigLoad(repoId);
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) {
			if (this.#isLatestConfigLoad(repoId, attempt)) this.#setConfigError(repoId, found.error);
			return found;
		}
		if (found.value === null) {
			const missing = appError("repo_unknown", "That project no longer exists.");
			if (this.#isLatestConfigLoad(repoId, attempt)) this.#setConfigError(repoId, missing);
			return err(missing);
		}

		const rootPath = found.value.rootPath;
		const shared = await this.#deps.settings.readSettingsFile(sharedSettingsFile(rootPath));
		if (!shared.ok) {
			if (this.#isLatestConfigLoad(repoId, attempt)) this.#setConfigError(repoId, shared.error);
			return shared;
		}
		const local = await this.#deps.settings.readSettingsFile(localSettingsFile(rootPath));
		if (!local.ok) {
			if (this.#isLatestConfigLoad(repoId, attempt)) this.#setConfigError(repoId, local.error);
			return local;
		}
		const read = repoConfigFrom(shared.value, local.value);
		const config = read.config;
		const current = this.store.getState().configs[repoId];
		if (!this.#isLatestConfigLoad(repoId, attempt)) {
			return ok(current ?? config);
		}

		const state = this.store.getState();
		const configErrors = { ...state.configErrors };
		delete configErrors[repoId];
		const configDropped = { ...state.configDropped };
		configDropped[repoId] = [...shared.value.dropped, ...local.value.dropped, ...read.dropped];
		this.store.setState({
			...state,
			configs: { ...state.configs, [repoId]: config },
			configErrors,
			configDropped,
		});
		return ok(config);
	}

	/** Backs `Actions.projects.updateConfig`. Writes the local file, leaving the shared one alone. */
	async updateConfig(repoId: RepoId, config: RepoConfig): Promise<Result<void>> {
		// Any read that began before this write may not put its older contents in the store.
		this.#nextConfigLoad(repoId);
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}

		const file = localSettingsFile(found.value.rootPath);
		const shared = await this.#deps.settings.readSettingsFile(
			sharedSettingsFile(found.value.rootPath),
		);
		if (!shared.ok) return shared;
		const sharedConfig = repoConfigFrom(shared.value, emptyFileContents(shared.value.file)).config;

		const written = await this.#deps.settings.updateSettingsFile(file, "repo", (contents) => {
			writeText(contents, "setup_script", config.setupScript, sharedConfig.setupScript);
			writeText(contents, "archive_script", config.archiveScript, sharedConfig.archiveScript);
			writeIfDifferent(contents, "run_script_mode", config.runMode, sharedConfig.runMode);
			writeList(contents, "file_include_globs", config.copyFiles, sharedConfig.copyFiles);
			writeList(
				contents,
				"open_url_template",
				config.previewUrlTemplate === null ? [] : [config.previewUrlTemplate],
				sharedConfig.previewUrlTemplate === null ? [] : [sharedConfig.previewUrlTemplate],
			);
			writeIfDifferent(
				contents,
				"spotlight_testing",
				config.spotlightTesting,
				sharedConfig.spotlightTesting,
			);
			writeIfDifferent(
				contents,
				"auto_run_after_setup",
				config.autoRunAfterSetup,
				sharedConfig.autoRunAfterSetup,
			);
			writeText(contents, "remote_name", config.remoteName, sharedConfig.remoteName);
			writeText(
				contents,
				"custom_prompt_general",
				config.prompts.general,
				sharedConfig.prompts.general,
			);
			writeText(
				contents,
				"custom_prompt_code_review",
				config.prompts.codeReview,
				sharedConfig.prompts.codeReview,
			);
			writeText(
				contents,
				"custom_prompt_create_pr",
				config.prompts.createPr,
				sharedConfig.prompts.createPr,
			);
			writeText(
				contents,
				"custom_prompt_fix_errors",
				config.prompts.fixErrors,
				sharedConfig.prompts.fixErrors,
			);
			writeText(
				contents,
				"custom_prompt_resolve_merge_conflicts",
				config.prompts.resolveConflicts,
				sharedConfig.prompts.resolveConflicts,
			);
			writeText(
				contents,
				"custom_prompt_rename_branch",
				config.prompts.renameBranch,
				sharedConfig.prompts.renameBranch,
			);
			delete contents.values.run_script;
			contents.actions = localActionsFrom(config.runScripts, sharedConfig.runScripts);
			contents.preserved = withoutRepoConfigPreserved(contents.preserved);
		});
		if (!written.ok) return written;

		// A read that began during the write may not overwrite the config that just reached disk.
		this.#nextConfigLoad(repoId);
		const state = this.store.getState();
		const configErrors = { ...state.configErrors };
		delete configErrors[repoId];
		const configDropped = { ...state.configDropped };
		delete configDropped[repoId];
		this.store.setState({
			...state,
			configs: { ...state.configs, [repoId]: config },
			configErrors,
			configDropped,
		});
		return ok(undefined);
	}

	/**
	 * Backs `Actions.projects.setIcon`. An uploaded file must be a PNG, JPEG, GIF, WebP or SVG under
	 * 10 MB; it is copied into the app's icon folder and the saved value names the copy. An emoji is
	 * saved as text, and null clears the icon so the favicon, owner avatar or letter shows again.
	 */
	async setIcon(repoId: RepoId, icon: RepoIconChoice): Promise<Result<void>> {
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) return err(appError("repo_icon_failed", ICON_FAILED_MESSAGE, found.error));
		const repo = found.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		let stored: string | null;
		let copiedTo: string | null = null;
		if (icon === null) {
			stored = null;
		} else if (icon.kind === "emoji") {
			const emoji = icon.emoji.trim();
			if (emoji === "") {
				return err(appError("repo_icon_empty", "Choose an emoji first."));
			}
			stored = emojiIconValue(emoji);
		} else {
			const extension = iconExtension(icon.path);
			if (extension === null || !ICON_EXTENSIONS.has(extension)) {
				return err(appError("repo_icon_type", ICON_TYPE_MESSAGE));
			}
			// Only the picked file is opened to the file commands for its size, never its folder.
			const reachable = await this.#deps.platform.fs.registerRoot(icon.path);
			if (!reachable.ok) {
				return err(appError("repo_icon_failed", ICON_FAILED_MESSAGE, reachable.error));
			}
			const stat = await this.#deps.platform.fs.stat(icon.path);
			if (!stat.ok) return err(appError("repo_icon_failed", ICON_FAILED_MESSAGE, stat.error));
			if (stat.value.isDirectory) return err(appError("repo_icon_type", ICON_TYPE_MESSAGE));
			if (stat.value.size > MAX_ICON_BYTES) {
				return err(appError("repo_icon_too_large", ICON_SIZE_MESSAGE));
			}
			const folder = repoIconsDir(this.#deps.platform.fs.paths);
			const exposed = await this.#deps.platform.fs.registerRoot(folder);
			if (!exposed.ok) {
				return err(appError("repo_icon_failed", ICON_FAILED_MESSAGE, exposed.error));
			}
			const made = await this.#deps.platform.fs.mkdirp(folder);
			if (!made.ok) return err(appError("repo_icon_failed", ICON_FAILED_MESSAGE, made.error));
			// A new name for every upload: the old file stays until the database points away from it,
			// and the web view cannot show a cached image from the same address.
			const destination = `${folder}/${repoId}-${this.#deps.ids.uuid()}.${extension}`;
			const copied = await copyFileKeepingMode(this.#deps.platform.shell, icon.path, destination);
			if (!copied.ok) {
				return err(appError("repo_icon_failed", ICON_FAILED_MESSAGE, copied.error));
			}
			stored = fileIconValue(destination);
			copiedTo = destination;
		}

		const written = await this.#deps.repos.repos.setIcon(repoId, stored);
		if (!written.ok) {
			// The database kept the old icon, so the copy just made is not referenced.
			if (copiedTo !== null) {
				const cleaned = await trashIfPresent(this.#deps.platform.fs, copiedTo);
				return err(
					appError(
						"repo_icon_failed",
						ICON_FAILED_MESSAGE,
						cleaned.ok ? written.error : cleaned.error,
					),
				);
			}
			return err(appError("repo_icon_failed", ICON_FAILED_MESSAGE, written.error));
		}

		this.#upsert({ ...repo, icon: stored });
		// The database no longer points to the earlier upload, so it goes to the Trash.
		const previous = fileIconPath(repo.icon);
		if (previous !== null && previous !== copiedTo) {
			const removed = await trashIfPresent(this.#deps.platform.fs, previous);
			if (!removed.ok) {
				return err(
					appError(
						"repo_icon_cleanup_failed",
						"The icon changed, but the old image could not be moved to the Trash.",
						removed.error,
					),
				);
			}
		}
		return ok(undefined);
	}

	async setHidden(repoId: RepoId, hidden: boolean): Promise<Result<void>> {
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		const written = await this.#deps.repos.repos.setHidden(repoId, hidden);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, hidden });
		return ok(undefined);
	}

	/**
	 * Backs `Actions.projects.createGitHubRepo`: renames an existing origin to upstream, creates the
	 * repository from this folder, pushes the current branch with its upstream set (gh is the
	 * credential helper for github.com), and returns the repository's web URL. A folder with no
	 * commits gets a first commit only when it is empty, holding only .gitkeep; one with files is
	 * refused, so nothing the user did not choose is published. A failure after the create removes
	 * the origin gh added, and a failure after the rename puts the old origin back, so the
	 * project's remotes are as they were; the repository on GitHub stays, and the error says so.
	 * The `git init`, .gitkeep and first commit stay too: research 3.2 undoes only the rename.
	 */
	async createGitHubRepo(
		repoId: RepoId,
		input: { owner: string; name: string; isPrivate: boolean },
	): Promise<Result<string>> {
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		const name = projectFolderName(input.name);
		if (name === "") {
			return err(appError("repo_name_invalid", "Repository name must include letters or numbers."));
		}
		const owner = input.owner.trim();
		if (owner === "") {
			return err(appError("repo_owner_missing", "Choose a GitHub account or organisation."));
		}
		const rootPath = found.value.rootPath;
		const gitDir = await this.#deps.platform.fs.stat(`${rootPath}/.git`);
		if (!gitDir.ok) {
			const initialised = await this.#deps.git.runChecked(initRepository(), { cwd: rootPath });
			if (!initialised.ok) {
				return err(
					appError(
						"github_repo_init_failed",
						`Couldn't initialize Git in ${rootPath}. ${initialised.error.message}`,
						initialised.error,
					),
				);
			}
		}

		const origin = await this.#deps.git.run(remoteGetUrl("origin"), { cwd: rootPath });
		const hasOrigin = origin.ok && origin.value.exitCode === 0 && origin.value.stdout.trim() !== "";
		let renamed = false;
		if (hasOrigin) {
			const upstream = await this.#deps.git.run(remoteGetUrl("upstream"), { cwd: rootPath });
			const hasUpstream =
				upstream.ok && upstream.value.exitCode === 0 && upstream.value.stdout.trim() !== "";
			if (hasUpstream) {
				return err(
					appError(
						"repo_upstream_exists",
						"This project already has an upstream remote. Rename or remove it, then try again.",
					),
				);
			}
			const moved = await this.#deps.git.runChecked(remoteRename("origin", "upstream"), {
				cwd: rootPath,
			});
			if (!moved.ok) {
				return err(
					appError(
						"github_repo_rename_failed",
						`Couldn't move the existing origin remote aside. ${moved.error.message}`,
						moved.error,
					),
				);
			}
			renamed = true;
		}

		const ownerSlashName = `${owner}/${name}`;
		// Set once `gh repo create` has made the repository and added it as origin.
		let created = false;
		const fail = async (cause: AppError): Promise<Result<string>> => {
			// The repository on GitHub stays: deleting it needs a scope the sign-in may not have, and
			// the user may want it. The message says it is there.
			const failure = created
				? appError(
						cause.code,
						`${cause.message} The repository ${ownerSlashName} was created on GitHub and is still there.`,
						cause.cause,
					)
				: cause;
			// gh added the new repository as origin, so it goes first: git refuses to rename a remote
			// onto a name that is taken.
			if (created) {
				const removed = await this.#deps.git.runChecked(remoteRemove("origin"), { cwd: rootPath });
				if (!removed.ok) {
					return err(
						appError(
							"github_repo_restore_failed",
							`${failure.message} The new origin remote could not be removed. ${removed.error.message}`,
							failure,
						),
					);
				}
			}
			if (!renamed) return err(failure);
			const restored = await this.#deps.git.runChecked(remoteRename("upstream", "origin"), {
				cwd: rootPath,
			});
			if (!restored.ok) {
				return err(
					appError(
						"github_repo_restore_failed",
						`${failure.message} The original origin remote could not be restored. ${restored.error.message}`,
						failure,
					),
				);
			}
			return err(failure);
		};

		const head = await this.#deps.git.run(revParseVerify("HEAD"), { cwd: rootPath });
		if (!head.ok) {
			return fail(
				appError(
					"github_repo_head_failed",
					`Couldn't read the project's commits. ${head.error.message}`,
					head.error,
				),
			);
		}
		if (head.value.exitCode !== 0) {
			const status = await this.#deps.git.stdout(statusPorcelainAll(), { cwd: rootPath });
			if (!status.ok) {
				return fail(
					appError(
						"github_repo_head_failed",
						`Couldn't read the project's changes. ${status.error.message}`,
						status.error,
					),
				);
			}
			// Committing files the user never chose (an .env, keys) would publish them, so only an
			// empty folder gets a first commit here, and that commit holds only .gitkeep.
			if (status.value !== "") {
				return fail(
					appError(
						"github_repo_no_commits",
						"This project has files but no commits yet. Commit the files you want on GitHub, then try again.",
					),
				);
			}
			const keep = await this.#deps.platform.fs.writeTextAtomic(`${rootPath}/.gitkeep`, "");
			if (!keep.ok) {
				return fail(
					appError(
						"github_repo_commit_failed",
						`Couldn't prepare the first commit. ${keep.error.message}`,
						keep.error,
					),
				);
			}
			const added = await this.#deps.git.runChecked(addPath(".gitkeep"), { cwd: rootPath });
			if (!added.ok) {
				return fail(
					appError(
						"github_repo_commit_failed",
						`Couldn't stage the first commit. ${added.error.message}`,
						added.error,
					),
				);
			}
			const committed = await this.#deps.git.runChecked(commitAll("Initial commit"), {
				cwd: rootPath,
			});
			if (!committed.ok) {
				return fail(
					appError(
						"github_repo_commit_failed",
						`Couldn't make the first commit. ${committed.error.message}`,
						committed.error,
					),
				);
			}
		}

		const made = await this.#deps.git.runChecked(
			githubRepoCreate(ownerSlashName, `A repository for ${name}`, input.isPrivate, "."),
			{ cwd: rootPath },
		);
		if (!made.ok) {
			return fail(
				appError(
					"github_repo_create_failed",
					`Couldn't create the GitHub repository ${ownerSlashName}. ${made.error.message}`,
					made.error,
				),
			);
		}
		created = true;
		const pushed = await this.#deps.git.runChecked(pushSetUpstreamHeadWithGh("origin"), {
			cwd: rootPath,
		});
		if (!pushed.ok) {
			return fail(
				appError(
					"github_repo_push_failed",
					`The current branch could not be pushed to the new repository. ${pushed.error.message}`,
					pushed.error,
				),
			);
		}
		const remote = await this.#deps.git.stdout(remoteGetUrl("origin"), { cwd: rootPath });
		if (!remote.ok || remote.value === "") {
			return fail(
				appError(
					"github_repo_remote_missing",
					"The new repository's origin remote could not be read.",
					remote.ok ? undefined : remote.error,
				),
			);
		}
		const url = await this.#deps.git.stdout(githubRepoUrl(ownerSlashName), { cwd: rootPath });
		if (!url.ok || url.value === "") {
			return fail(
				appError(
					"github_repo_url_missing",
					"The new repository's web address could not be read.",
					url.ok ? undefined : url.error,
				),
			);
		}
		const canonical = normaliseRemoteUrl(remote.value);
		const saved = await this.#deps.repos.repos.setRemoteUrl(repoId, canonical);
		if (!saved.ok) return err(saved.error);
		this.#upsert({ ...found.value, remoteUrl: canonical });
		return ok(url.value);
	}

	/**
	 * Backs `Actions.projects.resetRunAction`: drops this Mac's change to a shared action by
	 * rewriting the local file without that action, then forgets that it was hidden.
	 */
	async resetRunAction(repoId: RepoId, actionId: string): Promise<Result<void>> {
		const loaded = await this.loadConfig(repoId);
		if (!loaded.ok) return loaded;
		const remaining = loaded.value.runScripts.filter(
			(action) => !actionIdsEqual(action.id, actionId),
		);
		const saved = await this.updateConfig(repoId, {
			...loaded.value,
			runScripts: remaining,
		});
		if (!saved.ok) return saved;
		return this.setRunActionHidden(repoId, actionId, false);
	}

	/** Backs `Actions.projects.setRunActionHidden`. Stores hidden ids in local storage only. */
	async setRunActionHidden(
		repoId: RepoId,
		actionId: string,
		hidden: boolean,
	): Promise<Result<void>> {
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		const current = readHiddenRunActions(repoId);
		if (!current.ok) return current;
		const next = current.value.filter((id) => !actionIdsEqual(id, actionId));
		if (hidden) next.push(actionId);
		return writeHiddenRunActions(repoId, next);
	}

	/** Stops the window focus listener. The composition root calls it on stop, and tests after use. */
	dispose(): void {
		this.#unsubscribeFocus?.();
		this.#unsubscribeFocus = null;
	}

	/**
	 * Re-reads the config files of every repository whose config is already shown when the window
	 * gains focus, so an edit made in another editor appears without reopening the page. A repo
	 * whose last read failed is retried too, so fixing the file clears the error.
	 */
	#ensureConfigReloading(): void {
		if (this.#unsubscribeFocus !== null) return;
		const window = this.#deps.platform.window;
		if (window === undefined) return;
		this.#unsubscribeFocus = window.onFocusChanged((focused) => {
			if (!focused) return;
			void this.#reloadLoadedConfigs();
		});
	}

	async #reloadLoadedConfigs(): Promise<void> {
		const state = this.store.getState();
		const repoIds = new Set([
			...Object.keys(state.configs),
			...Object.keys(state.configErrors ?? {}),
		]);
		for (const repoId of repoIds) {
			await this.loadConfig(repoId as RepoId);
		}
	}

	#nextConfigLoad(repoId: RepoId): number {
		const attempt = (this.#configLoads.get(repoId) ?? 0) + 1;
		this.#configLoads.set(repoId, attempt);
		return attempt;
	}

	#isLatestConfigLoad(repoId: RepoId, attempt: number): boolean {
		return this.#configLoads.get(repoId) === attempt;
	}

	#setConfigError(repoId: RepoId, error: AppError): void {
		const state = this.store.getState();
		this.store.setState({
			...state,
			configErrors: { ...state.configErrors, [repoId]: error },
		});
	}

	/** Records what the clone is doing, for the dialog that started it. */
	#setCloneProgress(progress: CloneProgress): void {
		this.store.setState((state) => ({ ...state, cloneProgress: progress }));
	}

	/** Puts one repository in the store and recomputes the sidebar order. */
	#upsert(repo: Repo): void {
		const state = this.store.getState();
		const reposById = { ...state.reposById, [repo.id]: repo };
		this.store.setState({
			...state,
			loaded: true,
			reposById,
			order: visibleOrder(reposById),
		});
	}

	/** Runs the commands a template needs inside the folder Quick start made. */
	async #prepareTemplate(
		parentDir: string,
		destination: string,
		folder: string,
		template: ProjectTemplate,
	): Promise<Result<void>> {
		if (template === "empty") {
			const initialised = await this.#deps.git.runChecked(initRepository(), {
				cwd: destination,
			});
			if (!initialised.ok) {
				return err(
					appError(
						"repo_template_failed",
						`Couldn't initialize Git in ${destination}. ${initialised.error.message}`,
						initialised.error,
					),
				);
			}
			const keep = await this.#deps.platform.fs.writeTextAtomic(`${destination}/.gitkeep`, "");
			if (!keep.ok) return keep;
			return this.#firstCommit(destination, "Initial commit");
		}

		if (template === "nextjs") {
			const made = await this.#deps.git.runChecked(
				{
					program: "zsh",
					args: [
						"-lc",
						`npx --yes create-next-app@latest ${folder} --yes --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm`,
					],
					timeoutMs: 10 * 60_000,
				},
				{ cwd: parentDir },
			);
			if (!made.ok) {
				return err(
					appError(
						"repo_template_failed",
						`Couldn't create the Next.js project. ${made.error.message}`,
						made.error,
					),
				);
			}
			const env = await this.#deps.platform.fs.writeTextAtomic(`${destination}/.env.local`, "");
			return env.ok ? ok(undefined) : env;
		}

		const initialised = await this.#deps.git.runChecked(initRepository(), { cwd: destination });
		if (!initialised.ok) {
			return err(
				appError(
					"repo_template_failed",
					`Couldn't initialize Git in ${destination}. ${initialised.error.message}`,
					initialised.error,
				),
			);
		}
		const skills = await this.#deps.platform.fs.mkdirp(`${destination}/.claude/skills`);
		if (!skills.ok) return skills;
		const gstackPath = `${destination}/.claude/skills/gstack`;
		const cloned = await this.#deps.git.runChecked(
			cloneWithProgress(GSTACK_TEMPLATE_URL, gstackPath),
			{ cwd: parentDir },
		);
		if (!cloned.ok) {
			return err(
				appError(
					"repo_template_failed",
					`Couldn't download the gstack template. ${cloned.error.message}`,
					cloned.error,
				),
			);
		}
		for (const host of ["claude", "codex"] as const) {
			const setup = await this.#deps.git.runChecked(
				{ program: "zsh", args: ["-lc", `./setup --host ${host}`] },
				{ cwd: gstackPath },
			);
			if (!setup.ok) {
				return err(
					appError(
						"repo_template_failed",
						`Couldn't set up gstack for ${host}. ${setup.error.message}`,
						setup.error,
					),
				);
			}
		}
		const nestedGit = `${gstackPath}/.git`;
		if (await this.#deps.platform.fs.exists(nestedGit)) {
			const removed = await this.#deps.platform.fs.trash(nestedGit);
			if (!removed.ok) {
				return err(
					appError(
						"repo_template_failed",
						`Couldn't finish the gstack template. ${removed.error.message}`,
						removed.error,
					),
				);
			}
		}
		return this.#firstCommit(destination, "Initial commit with gstack");
	}

	/** Stages everything and commits it once, for a folder Quick start made. */
	async #firstCommit(path: string, message: string): Promise<Result<void>> {
		const added = await this.#deps.git.runChecked(addAll(), { cwd: path });
		if (!added.ok) {
			return err(
				appError(
					"repo_template_failed",
					`Couldn't stage the first commit. ${added.error.message}`,
					added.error,
				),
			);
		}
		const committed = await this.#deps.git.runChecked(commitAll(message), { cwd: path });
		if (!committed.ok) {
			return err(
				appError(
					"repo_template_failed",
					`Couldn't make the first commit. ${committed.error.message}`,
					committed.error,
				),
			);
		}
		return ok(undefined);
	}

	/** Moves a failed Quick start's folder to the Trash, and reports both failures if that fails. */
	async #removeCreatedFolder(destination: string, failure: AppError): Promise<Result<void>> {
		const removed = await this.#deps.platform.fs.trash(destination);
		if (!removed.ok) {
			return err(
				appError(
					"repo_template_cleanup_failed",
					`${failure.message} The folder ${destination} could not be removed: ${removed.error.message}`,
					failure,
				),
			);
		}
		return ok(undefined);
	}

	/**
	 * The folder's git work tree root, asked from git so a subfolder of an existing repository
	 * resolves to that repository instead of becoming a nested one. When git does not see a work
	 * tree, the user is offered `git init` and the folder itself becomes the root.
	 */
	async #workTreeRoot(path: string): Promise<Result<string>> {
		const probe = await this.#deps.git.stdout(revParse("--show-toplevel"), { cwd: path });
		if (probe.ok && probe.value !== "") {
			return ok(normaliseRootPath(probe.value));
		}
		const agreed = await this.#deps.platform.dialogs.confirm({
			title: "Turn this folder into a Git repository?",
			message:
				"This folder is not a Git repository yet. Create one so you can add it as a project?",
			okLabel: "Create repository",
		});
		if (!agreed) {
			return err(appError("not_git", "That folder is not a Git repository."));
		}
		const initialised = await this.#deps.git.runChecked(initRepository(), { cwd: path });
		if (!initialised.ok) return initialised;
		return ok(path);
	}

	/** Reads `origin`'s URL and writes the trimmed form back when it differs. */
	async #readRemoteUrl(path: string): Promise<Result<string | null>> {
		const read = await this.#deps.git.stdout(remoteGetUrl("origin"), { cwd: path });
		if (!read.ok) return ok(null);
		const canonical = normaliseRemoteUrl(read.value);
		if (canonical === "") return ok(null);
		if (canonical !== read.value) {
			const written = await this.#deps.git.runChecked(remoteSetUrl("origin", canonical), {
				cwd: path,
			});
			if (!written.ok) return written;
		}
		return ok(canonical);
	}

	/** The remote's HEAD branch, else the checked-out branch. Fails when neither exists. */
	async #detectDefaultBranch(path: string): Promise<Result<string>> {
		const remoteHead = await this.#deps.git.stdout(symbolicRefRemoteHead("origin"), { cwd: path });
		const current = await this.#deps.git.stdout(branchShowCurrent(), { cwd: path });
		return defaultBranchFrom(
			remoteHead.ok ? remoteHead.value : null,
			current.ok ? current.value : null,
		);
	}
}
