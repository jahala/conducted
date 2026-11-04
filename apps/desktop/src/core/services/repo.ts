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
import { notImplemented, type RepoId, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { Repositories } from "../db/repositories.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo, RepoConfig, RepoIconChoice } from "../model.ts";
import type { SettingsService } from "./settings.ts";

export interface RepoState {
	loaded: boolean;
	reposById: Readonly<Record<string, Repo>>;
	/** Ids in sidebar order. */
	order: readonly RepoId[];
	configs: Readonly<Record<string, RepoConfig>>;
}

/** Called before a repo is removed so running scripts stop and workspaces go. */
export interface RepoRemovalPort {
	removeWorkspacesOf(repoId: RepoId): Promise<Result<void>>;
}

export interface RepoServiceDeps {
	platform: Pick<Platform, "fs" | "opener">;
	git: GitRunner;
	repos: Pick<Repositories, "repos" | "settings">;
	settings: Pick<SettingsService, "readSettingsFile" | "setForRepo">;
	removal: RepoRemovalPort;
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

	start(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("PRJ-01");
	}

	/** Backs `Actions.projects.addLocal`. */
	addLocal(_path: string): Promise<Result<Repo>> {
		return notImplemented("PRJ-01");
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
	remove(_repoId: RepoId): Promise<Result<void>> {
		return notImplemented("PRJ-01");
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

	setHidden(_repoId: RepoId, _hidden: boolean): Promise<Result<void>> {
		return notImplemented("PRJ-01");
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
}
