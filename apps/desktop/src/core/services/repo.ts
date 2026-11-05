/**
 * @feature PRJ-01 Projects (repositories): add, clone, create, remove, configure
 * Owns: the list of repositories, adding one from a folder or from GitHub, starting a new one from
 * a template, removing one, and each repository's config (scripts, files to copy, prompts).
 * Behaviour: ui-map.md 3.9 (add project flows), services-map.md 3.2 (add repository steps: `git
 * init` when missing, remote URL, default branch detection, clone with progress), 4.2.4
 * (scripts, run mode, files to copy, prompts in settings.toml), 2.3.2 (repo operations).
 * Must handle: a folder that is not a git repository (offer `git init`, never silently); a path
 * already added (return the existing project); a repository with no commits (workspace creation
 * makes the first commit, not this service); the default branch comes from the remote's HEAD,
 * else the checked-out branch; a clone that fails halfway leaves no folder behind (move to the
 * Trash); removing a project stops its runs, archives nothing silently, moves its workspace
 * folders to the Trash and leaves the main clone alone; the repo's `.conducted/` folder is added
 * to the git exclude as needed (`settings.local.toml` stays local); a config write goes to the
 * local settings file, never the committed one.
 * Our design choice: scripts and prompts live in the settings files (see services/settings.ts),
 * not in table columns. This service only maps them to `RepoConfig`.
 * Test first: adding the same folder twice returns the same project without a second row.
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
import type { Repositories } from "../db/repositories.ts";
import {
	branchShowCurrent,
	initRepository,
	remoteGetUrl,
	remoteSetUrl,
	symbolicRefRemoteHead,
} from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo, RepoConfig, RepoIconChoice } from "../model.ts";
import type { SettingsService } from "./settings.ts";

export interface RepoState {
	loaded: boolean;
	reposById: Readonly<Record<string, Repo>>;
	/** Ids in sidebar order. Hidden repositories are not listed. */
	order: readonly RepoId[];
	configs: Readonly<Record<string, RepoConfig>>;
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
 * The remote's HEAD branch when it has one, otherwise the checked-out branch, otherwise `main`.
 * `remoteHead` is the full ref name such as `refs/remotes/origin/main`.
 */
export function defaultBranchFrom(remoteHead: string | null, current: string | null): string {
	if (remoteHead !== null) {
		const match = /^refs\/remotes\/[^/]+\/(.+)$/.exec(remoteHead);
		if (match?.[1] !== undefined && match[1] !== "") return match[1];
	}
	return current !== null && current !== "" ? current : "main";
}

/** Called before a repo is removed so running scripts stop and workspaces go. */
export interface RepoRemovalPort {
	removeWorkspacesOf(repoId: RepoId): Promise<Result<void>>;
}

export interface RepoServiceDeps {
	platform: Pick<Platform, "fs" | "opener" | "dialogs">;
	git: GitRunner;
	repos: Pick<Repositories, "repos" | "settings">;
	settings: Pick<SettingsService, "readSettingsFile" | "setForRepo">;
	removal: RepoRemovalPort;
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

		const existing = await this.#deps.repos.repos.getByRootPath(path);
		if (!existing.ok) return existing;
		if (existing.value !== null) {
			this.#upsert(existing.value);
			return ok(existing.value);
		}

		const folder = await this.#deps.platform.fs.stat(path);
		if (!folder.ok) {
			return err(appError("repo_path_missing", `Can't find the folder ${path}.`, folder.error));
		}
		if (!folder.value.isDirectory) {
			return err(appError("repo_not_directory", `${path} is not a folder.`));
		}

		const hasGitFolder = await this.#deps.platform.fs.exists(`${path}/.git`);
		if (!hasGitFolder) {
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
		}

		const remote = await this.#readRemoteUrl(path);
		if (!remote.ok) return remote;
		const defaultBranch = await this.#detectDefaultBranch(path);

		const created = await this.#deps.repos.repos.create({
			name: projectNameFromPath(path),
			rootPath: path,
			remoteUrl: remote.value,
			defaultBranch,
			icon: null,
		});
		if (!created.ok) {
			// Two adds raced past the lookup: answer with the row the other add stored.
			if (created.error.code === "db.conflict") {
				const raced = await this.#deps.repos.repos.getByRootPath(path);
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
		this.store.setState({
			reposById,
			configs,
			order: state.order.filter((id) => id !== repoId),
		});
		return ok(undefined);
	}

	/** Reads the config files of a repository and fills the store. Backs `useRepoConfig`. */
	loadConfig(_repoId: RepoId): Promise<Result<RepoConfig>> {
		return notImplemented("PRJ-04");
	}

	/** Backs `Actions.projects.updateConfig`. */
	updateConfig(_repoId: RepoId, _config: RepoConfig): Promise<Result<void>> {
		return notImplemented("PRJ-04");
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

	/** The remote's HEAD branch, else the checked-out branch, else `main`. */
	async #detectDefaultBranch(path: string): Promise<string> {
		const remoteHead = await this.#deps.git.stdout(symbolicRefRemoteHead("origin"), { cwd: path });
		const current = await this.#deps.git.stdout(branchShowCurrent(), { cwd: path });
		return defaultBranchFrom(
			remoteHead.ok ? remoteHead.value : null,
			current.ok ? current.value : null,
		);
	}
}
