/**
 * @feature PRJ-01 Projects (repositories): add and list from a local folder, remove
 * Owns: the list of repositories, adding one from a local folder, removing one, and hiding one
 * from the sidebar. Also owns PRJ-04's config reads: scripts, files to copy and prompts come from
 * `.conducted/settings.toml`, with `.conducted/settings.local.toml` overriding it. Cloning,
 * creating from a template and icons are placeholders for PRJ-02, PRJ-03 and PRJ-05.
 * Behaviour: ui-map.md 3.9 (add project), 4 item 8 (Add project menu), services-map.md 3.2 (add
 * repository steps: `git init` when missing, remote URL read and normalised, default branch
 * detection), 2.3.2 (repo operations), 1.4 (config group), 4.2 (the repo settings file),
 * 2.5.2 (reload on focus), frontend.md 6 (scripts config in settings.toml).
 * Must handle: a folder that is not a git repository (offer `git init`, never silently); a folder
 * inside an existing repository (ask git for the work tree root, so no nested repository is made);
 * a path already added (return the existing project); a repository with no commits (workspace
 * creation makes the first commit, not this service); the default branch comes from the remote's
 * HEAD, else the checked-out branch, and the add fails visibly when neither exists; removing a
 * project asks its removal port to stop work and delete its workspaces before deleting the row;
 * an invalid settings file is reported instead of replaced; a config edit made outside the app is
 * read again when the window regains focus; only the newest load may change the store.
 * Our design choice: `RepoConfig` is the shared file overlaid by the local file. The shared file
 * stays committed and read-only in the UI; `updateConfig` writes the local file only.
 * Test first: the repo's scripts, prompts, globs and run mode are read from
 * `.conducted/settings.toml`.
 */
import {
	type AppError,
	appError,
	err,
	notImplemented,
	ok,
	type RepoId,
	type Result,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import { localSettingsFile, sharedSettingsFile } from "../app-paths.ts";
import type { Repositories } from "../db/repositories.ts";
import {
	branchShowCurrent,
	initRepository,
	remoteGetUrl,
	remoteSetUrl,
	revParse,
	symbolicRefRemoteHead,
} from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo, RepoConfig, RepoIconChoice, RunAction } from "../model.ts";
import { getSettingDef, type SettingValue } from "../registries/settings.ts";
import {
	actionIdsEqual,
	actionLabel,
	buildSettingsDocument,
	mergeSettingActions,
	SETTINGS_SAVE_FAILED_MESSAGE,
	type SettingAction,
	type SettingsFileContents,
	type SettingsService,
} from "./settings.ts";
import { tomlCodec } from "./toml-codec.ts";

export interface RepoState {
	loaded: boolean;
	reposById: Readonly<Record<string, Repo>>;
	/** Ids in sidebar order. Hidden repositories are not listed. */
	order: readonly RepoId[];
	configs: Readonly<Record<string, RepoConfig>>;
	/** Set when a config read failed, so the settings page can show the file's error. */
	configErrors?: Readonly<Record<string, AppError>>;
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

/** The folder's own name, used as the project name. */
export function projectNameFromPath(path: string): string {
	const trimmed = normaliseRootPath(path);
	const parts = trimmed.split("/");
	return parts.at(-1) || trimmed || "Project";
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

/** Called before a repo is removed so running scripts stop and workspaces go. */
export interface RepoRemovalPort {
	removeWorkspacesOf(repoId: RepoId): Promise<Result<void>>;
}

export interface RepoServiceDeps {
	platform: Pick<Platform, "fs" | "opener" | "dialogs"> & {
		window?: Pick<Platform["window"], "onFocusChanged">;
	};
	git: GitRunner;
	repos: Pick<Repositories, "repos" | "settings">;
	settings: Pick<SettingsService, "readSettingsFile">;
	removal: RepoRemovalPort;
}

/** Reads the winning value of a key: the local file over the shared file. */
function valueFrom(
	shared: SettingsFileContents,
	local: SettingsFileContents,
	key: string,
): unknown {
	return Object.hasOwn(local.values, key) ? local.values[key] : shared.values[key];
}

const asText = (value: unknown): string | null =>
	typeof value === "string" && value !== "" ? value : null;

const asList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const asFlag = (value: unknown, fallback: boolean): boolean =>
	typeof value === "boolean" ? value : fallback;

const asRunMode = (value: unknown): RepoConfig["runMode"] =>
	value === "exclusive" ? "exclusive" : "concurrent";

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

/**
 * The effective per-repo config: the shared file, with each value the local file sets winning.
 * Prompts, globs and scripts all come from the same two files, as the settings pages expect.
 */
export function repoConfigFrom(
	shared: SettingsFileContents,
	local: SettingsFileContents,
): RepoConfig {
	const value = (key: string): unknown => valueFrom(shared, local, key);
	const prompt = (key: string): string | null => asText(value(key));
	return {
		setupScript: asText(value("setup_script")),
		runScripts: runActionsFrom(shared, local),
		runMode: asRunMode(value("run_script_mode")),
		archiveScript: asText(value("archive_script")),
		copyFiles: asList(value("file_include_globs")),
		previewUrlTemplate: asList(value("open_url_template"))[0] ?? null,
		spotlightTesting: asFlag(value("spotlight_testing"), false),
		autoRunAfterSetup: asFlag(value("auto_run_after_setup"), false),
		remoteName: asText(value("remote_name")),
		prompts: {
			general: prompt("custom_prompt_general"),
			codeReview: prompt("custom_prompt_code_review"),
			createPr: prompt("custom_prompt_create_pr"),
			fixErrors: prompt("custom_prompt_fix_errors"),
			resolveConflicts: prompt("custom_prompt_resolve_merge_conflicts"),
			renameBranch: prompt("custom_prompt_rename_branch"),
		},
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

/** Replaces one file value, or removes it when the config leaves it empty. */
function setOrDelete(
	contents: SettingsFileContents,
	key: string,
	value: SettingValue | null,
): void {
	if (value === null || value === undefined) delete contents.values[key];
	else contents.values[key] = value;
}

/** The local action tables an update writes: only actions that are not untouched shared ones. */
function localActionsFrom(actions: readonly RunAction[]): Record<string, SettingAction> {
	const result: Record<string, SettingAction> = {};
	for (const action of actions) {
		if (action.origin === "shared") continue;
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

		const folder = await this.#deps.platform.fs.stat(path);
		if (!folder.ok) {
			return err(appError("repo_path_missing", `Can't find the folder ${path}.`, folder.error));
		}
		if (!folder.value.isDirectory) {
			return err(appError("repo_not_directory", `${path} is not a folder.`));
		}

		const rootPath = await this.#workTreeRoot(path);
		if (!rootPath.ok) return rootPath;

		const existing = await this.#deps.repos.repos.getByRootPath(rootPath.value);
		if (!existing.ok) return existing;
		if (existing.value !== null) {
			this.#upsert(existing.value);
			return ok(existing.value);
		}

		const remote = await this.#readRemoteUrl(rootPath.value);
		if (!remote.ok) return remote;
		const defaultBranch = await this.#detectDefaultBranch(rootPath.value);
		if (!defaultBranch.ok) return defaultBranch;

		const created = await this.#deps.repos.repos.create({
			name: projectNameFromPath(rootPath.value),
			rootPath: rootPath.value,
			remoteUrl: remote.value,
			defaultBranch: defaultBranch.value,
			icon: null,
		});
		if (!created.ok) {
			// Two adds raced past the lookup: answer with the row the other add stored.
			if (created.error.code === "db.conflict") {
				const raced = await this.#deps.repos.repos.getByRootPath(rootPath.value);
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

	/** Backs `Actions.projects.clone`: `gh repo clone` or `git clone` with progress. */
	clone(_url: string, _parentDir: string): Promise<Result<Repo>> {
		return notImplemented("PRJ-02");
	}

	/** Backs `Actions.projects.createFromTemplate`. */
	createFromTemplate(_name: string, _parentDir: string, _template: string): Promise<Result<Repo>> {
		return notImplemented("PRJ-03");
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

		const state = this.store.getState();
		const reposById = { ...state.reposById };
		delete reposById[repoId];
		const configs = { ...state.configs };
		delete configs[repoId];
		const configErrors = { ...state.configErrors };
		delete configErrors[repoId];
		this.store.setState({
			reposById,
			configs,
			configErrors,
			order: state.order.filter((id) => id !== repoId),
		});
		return ok(undefined);
	}

	/**
	 * Reads the shared and local settings files of a repository, overlays them and fills the store.
	 * Backs `useRepoConfig`. A later call wins over an earlier one that finishes late.
	 */
	async loadConfig(repoId: RepoId): Promise<Result<RepoConfig>> {
		this.#ensureConfigReloading();
		const attempt = (this.#configLoads.get(repoId) ?? 0) + 1;
		this.#configLoads.set(repoId, attempt);
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
		const config = repoConfigFrom(shared.value, local.value);
		const current = this.store.getState().configs[repoId];
		if (!this.#isLatestConfigLoad(repoId, attempt)) {
			return ok(current ?? config);
		}

		const state = this.store.getState();
		const configErrors = { ...state.configErrors };
		delete configErrors[repoId];
		this.store.setState({
			...state,
			configs: { ...state.configs, [repoId]: config },
			configErrors,
		});
		return ok(config);
	}

	/** Backs `Actions.projects.updateConfig`. Writes the local file, leaving the shared one alone. */
	async updateConfig(repoId: RepoId, config: RepoConfig): Promise<Result<void>> {
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}

		const file = localSettingsFile(found.value.rootPath);
		const existing = await this.#deps.settings.readSettingsFile(file);
		if (!existing.ok) return existing;
		const contents = existing.value;

		setOrDelete(contents, "setup_script", config.setupScript);
		setOrDelete(contents, "archive_script", config.archiveScript);
		contents.values.run_script_mode = config.runMode;
		setOrDelete(
			contents,
			"file_include_globs",
			config.copyFiles.length === 0 ? null : [...config.copyFiles],
		);
		setOrDelete(
			contents,
			"open_url_template",
			config.previewUrlTemplate === null ? null : [config.previewUrlTemplate],
		);
		contents.values.spotlight_testing = config.spotlightTesting;
		contents.values.auto_run_after_setup = config.autoRunAfterSetup;
		setOrDelete(contents, "remote_name", config.remoteName);
		setOrDelete(contents, "custom_prompt_general", config.prompts.general);
		setOrDelete(contents, "custom_prompt_code_review", config.prompts.codeReview);
		setOrDelete(contents, "custom_prompt_create_pr", config.prompts.createPr);
		setOrDelete(contents, "custom_prompt_fix_errors", config.prompts.fixErrors);
		setOrDelete(contents, "custom_prompt_resolve_merge_conflicts", config.prompts.resolveConflicts);
		setOrDelete(contents, "custom_prompt_rename_branch", config.prompts.renameBranch);
		delete contents.values.run_script;
		contents.actions = localActionsFrom(config.runScripts);
		contents.preserved = withoutRepoConfigPreserved(contents.preserved);

		const document = buildSettingsDocument(contents, "repo");
		const written = await this.#deps.platform.fs.writeTextAtomic(
			file,
			tomlCodec.stringify(document),
		);
		if (!written.ok) {
			return err(appError("settings_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
		}

		const state = this.store.getState();
		const configErrors = { ...state.configErrors };
		delete configErrors[repoId];
		this.store.setState({
			...state,
			configs: { ...state.configs, [repoId]: config },
			configErrors,
		});
		return ok(undefined);
	}

	/** Backs `Actions.projects.setIcon`. A file is checked (PNG, JPEG, GIF, WebP or SVG, under 10 MB) and copied. */
	setIcon(_repoId: RepoId, _icon: RepoIconChoice): Promise<Result<void>> {
		return notImplemented("PRJ-05");
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

	/** Backs `Actions.projects.createGitHubRepo`. Undoes the earlier steps when a later one fails. */
	createGitHubRepo(
		_repoId: RepoId,
		_input: { owner: string; name: string; isPrivate: boolean },
	): Promise<Result<string>> {
		return notImplemented("PRJ-03");
	}

	/** Backs `Actions.projects.resetRunAction`. */
	resetRunAction(_repoId: RepoId, _actionId: string): Promise<Result<void>> {
		return notImplemented("SET-07");
	}

	/** Backs `Actions.projects.setRunActionHidden`. Writes the local settings layer only. */
	setRunActionHidden(_repoId: RepoId, _actionId: string, _hidden: boolean): Promise<Result<void>> {
		return notImplemented("SET-07");
	}

	/**
	 * Re-reads the config files of every repository whose config is already shown when the window
	 * gains focus, so an edit made in another editor appears without reopening the page.
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
		for (const repoId of Object.keys(this.store.getState().configs)) {
			await this.loadConfig(repoId as RepoId);
		}
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
