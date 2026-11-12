/**
 * @feature APP-17 Import from Conductor: find, dry run, import, cancel
 * @feature APP-18 Chat history from Conductor
 * Owns: `ConductorImportService`, which finds Conductor's database, makes the read-only copy, reads
 * the repository folders it names, builds the plan, measures the history it brings and reads the
 * free space on the database's disk, and shows it as a dry run; writes it when the user goes
 * ahead and the disk still has the space, then brings each chat's history (history.ts), reloads
 * the stores that show the imported rows, and removes the copy when the import ends, is
 * cancelled or fails, and at every start.
 * Behaviour: docs/plans/migrate-from-conductor.md (safety rules 1 to 7, "Where it lives").
 * Must handle: a dry run or an import while one runs is refused, never started twice; a cancel
 * while the dry run reads drops its copy once the read ends; the import
 * writes only the plan the user saw, and a plan is used once; an import the disk has no room for
 * is refused before it writes anything, with the space it needs and the space free, because the
 * free space is read again when it starts (D132); any failure leaves Conducted as it
 * was (apply.ts) and drops the copy, so the next try starts from a fresh dry run; chat history is
 * written once the rows have committed, chat by chat, so a chat whose history fails comes over
 * without it and is named in the outcome, and the copy stays until the last chat is read; the copy left by
 * a crash is removed at the next start; nothing of Conductor's is written: its database is copied
 * by the Rust shell, and its repository files and worktree list are only read; a store error
 * never carries a secret value, because values never leave the Rust shell.
 * Test first: the dry run lists what comes over and what stays, and changes nothing.
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Database, Platform } from "../../platform/platform.ts";
import { localSettingsFile, sharedSettingsFile } from "../app-paths.ts";
import { readExistingIds } from "../db/imported-ids.ts";
import type { Repositories } from "../db/repositories.ts";
import { worktreeList } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import { parseWorktreeList } from "../git/status.ts";
import type { SettingKey } from "../registries/settings.ts";
import {
	envVarKeychainKey,
	parseSettingsDocument,
	type SettingsFileContents,
	type SettingsService,
	type TomlCodec,
} from "../services/settings.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { applyImportPlan, type ImportedCounts } from "./apply.ts";
import { parseConductorRows } from "./conductor-rows.ts";
import { type HistoryOutcome, importChatHistories, measureChatHistories } from "./history.ts";
import {
	type ChatDefaults,
	type ConductedState,
	conductorDatabasePath,
	type HistorySize,
	type ImportPlan,
	type ImportPreview,
	importSpace,
	noSpaceError,
	type OfferedModels,
	planConductorImport,
	type RepoFolder,
	type SettingsFileWrite,
} from "./plan.ts";
import { EMPTY_SCRIPTS, scriptFileCandidates, scriptsOf } from "./scripts.ts";

/** The largest script file the dry run reads for CONDUCTOR_ names. */
const SCRIPT_FILE_LIMIT = 256 * 1024;

export type ImportPhase = "idle" | "planning" | "planned" | "importing" | "imported" | "failed";

export interface ConductorImportState {
	/** Conductor's database: its size, null when there is none, undefined before the first look. */
	found: { bytes: number } | null | undefined;
	phase: ImportPhase;
	preview: ImportPreview | null;
	imported: ImportedCounts | null;
	/** What became of each chat's history in the last import. */
	history: HistoryOutcome | null;
	error: AppError | null;
}

export interface ImportOutcome {
	imported: ImportedCounts;
	history: HistoryOutcome;
}

export interface ConductorImportServiceDeps {
	platform: Pick<Platform, "app" | "conductorImport" | "fs" | "keychain">;
	db: Database;
	repositories: () => Repositories;
	repositoriesOn: (db: Database) => Repositories;
	git: Pick<GitRunner, "stdout">;
	/** The sidecar, which maps chat history (APP-18). */
	sidecar: Pick<SidecarClient, "request">;
	toml: TomlCodec;
	settings: Pick<SettingsService, "updateSettingsFile" | "excludeLocalSettingsFromGit">;
	/** The config a new chat starts with, which an imported chat starts from. */
	chatDefaults: () => Result<ChatDefaults>;
	/** The model ids each agent offers, for favourites that name only a model. */
	offeredModels: () => Promise<OfferedModels>;
	/** Where Conducted puts workspaces. */
	workspacesRoot: () => string;
	withPorts: <T>(count: number, use: (ports: number[]) => Promise<Result<T>>) => Promise<Result<T>>;
	/** Loads the stores that show imported rows: projects, workspaces, chats and the rest. */
	reload: () => Promise<Result<void>>;
	log: (level: "info" | "warn", message: string) => void;
	now: () => number;
}

/** A dry run's plan, its copy and the history size it measured. */
interface Planned {
	copyPath: string;
	plan: ImportPlan;
	size: HistorySize;
	preview: ImportPreview;
}

const busy = (): AppError =>
	appError("import_busy", "The import is already working. Wait for it to finish.");

export class ConductorImportService {
	readonly store: StoreApi<ConductorImportState>;
	readonly #deps: ConductorImportServiceDeps;
	#plan: Planned | null = null;
	#working = false;
	/** Set when the user cancels while a dry run is still reading; the dry run then drops its copy. */
	#cancelled = false;

	constructor(deps: ConductorImportServiceDeps) {
		this.#deps = deps;
		this.store = createStore<ConductorImportState>(() => ({
			found: undefined,
			phase: "idle",
			preview: null,
			imported: null,
			history: null,
			error: null,
		}));
	}

	/** Removes a copy an earlier run left, then looks for Conductor's database. */
	async start(): Promise<Result<void>> {
		const discarded = await this.#deps.platform.conductorImport.discardCopies();
		if (!discarded.ok) return discarded;
		const found = await this.find();
		return found.ok ? ok(undefined) : found;
	}

	/** Whether Conductor's database is on this Mac. Only a stat: nothing is read. */
	async find(): Promise<Result<{ bytes: number } | null>> {
		const path = conductorDatabasePath(this.#deps.platform.fs.paths.home);
		const found = await this.#deps.platform.conductorImport.find(path);
		if (!found.ok) return found;
		const value = found.value === null ? null : { bytes: found.value };
		this.store.setState({ found: value });
		return ok(value);
	}

	/** The dry run: copies Conductor's database, reads it and lists what the import would do. */
	async preview(): Promise<Result<ImportPreview>> {
		if (this.#working) return err(busy());
		this.#working = true;
		this.#cancelled = false;
		this.store.setState({
			phase: "planning",
			preview: null,
			imported: null,
			history: null,
			error: null,
		});
		try {
			const cleared = await this.#dropCopy();
			if (!cleared.ok) {
				this.store.setState({ phase: "failed", error: cleared.error });
				return cleared;
			}
			const planned = await this.#planNow();
			if (this.#cancelled) {
				const dropped = await this.#dropCopy();
				if (!dropped.ok) {
					this.#deps.log(
						"warn",
						`The import's copy could not be removed: ${dropped.error.message}`,
					);
				}
				this.store.setState({ phase: "idle", preview: null });
				return err(appError("import_cancelled", "The dry run was cancelled."));
			}
			if (!planned.ok) {
				const dropped = await this.#dropCopy();
				if (!dropped.ok) {
					this.#deps.log(
						"warn",
						`The import's copy could not be removed: ${dropped.error.message}`,
					);
				}
				this.store.setState({ phase: "failed", error: planned.error });
				return planned;
			}
			this.#plan = planned.value;
			this.store.setState({ phase: "planned", preview: planned.value.preview });
			return ok(planned.value.preview);
		} finally {
			this.#working = false;
		}
	}

	/** Writes the plan the last dry run showed. The copy goes afterwards, whatever the outcome. */
	async run(): Promise<Result<ImportOutcome>> {
		if (this.#working) return err(busy());
		const planned = this.#plan;
		if (planned === null) {
			return err(appError("import_no_plan", "Run the dry run first, then import what it shows."));
		}
		this.#working = true;
		this.#plan = null;
		this.store.setState({ phase: "importing", error: null });
		try {
			const room = await this.#room(planned.size);
			const applied = !room.ok
				? room
				: await applyImportPlan(planned.plan, {
						db: this.#deps.db,
						repositoriesOn: this.#deps.repositoriesOn,
						conductorImport: this.#deps.platform.conductorImport,
						keychain: this.#deps.platform.keychain,
						fs: this.#deps.platform.fs,
						writeSettingsFile: (file) => this.#writeSettingsFile(file),
						withPorts: this.#deps.withPorts,
						copyPath: planned.copyPath,
						now: this.#deps.now(),
					});
			const done: Result<ImportOutcome> = applied.ok
				? ok({
						imported: applied.value,
						history: await importChatHistories(planned.plan.history, {
							db: this.#deps.db,
							repositoriesOn: this.#deps.repositoriesOn,
							conductorImport: this.#deps.platform.conductorImport,
							sidecar: this.#deps.sidecar,
							copyPath: planned.copyPath,
							now: this.#deps.now(),
						}),
					})
				: applied;
			const dropped = await this.#dropCopy();
			if (!dropped.ok) {
				// The next start removes it; the import's own outcome is what the user needs now.
				this.#deps.log("warn", `The import's copy could not be removed: ${dropped.error.message}`);
			}
			if (!done.ok) {
				this.store.setState({ phase: "failed", error: done.error });
				this.#deps.log("warn", `The import from Conductor stopped: ${done.error.message}`);
				return done;
			}
			const { imported, history } = done.value;
			for (const failure of history.failed) {
				this.#deps.log("warn", `A chat's history did not come over: ${failure.reason}`);
			}
			await this.#excludeLocalFiles(planned.plan.files);
			const reloaded = await this.#deps.reload();
			if (!reloaded.ok) {
				this.#deps.log("warn", `The imported rows did not load: ${reloaded.error.message}`);
			}
			this.store.setState({ phase: "imported", imported, history });
			this.#deps.log("info", "Imported from Conductor");
			return done;
		} finally {
			this.#working = false;
		}
	}

	/** Drops the dry run and its copy. */
	async cancel(): Promise<Result<void>> {
		if (this.#working) {
			// A dry run still reading drops its copy when it finishes; an import runs to its end.
			if (this.store.getState().phase === "planning") {
				this.#cancelled = true;
				return ok(undefined);
			}
			return err(busy());
		}
		this.#plan = null;
		const dropped = await this.#dropCopy();
		this.store.setState({ phase: "idle", preview: null, error: dropped.ok ? null : dropped.error });
		return dropped;
	}

	async #dropCopy(): Promise<Result<void>> {
		const discarded = await this.#deps.platform.conductorImport.discardCopies();
		return discarded.ok ? ok(undefined) : discarded;
	}

	/** Whether the disk still has the space the dry run measured; read again before any write. */
	async #room(size: HistorySize): Promise<Result<void>> {
		const free = await this.#deps.platform.app.databaseFreeBytes();
		if (!free.ok) return free;
		const space = importSpace(size, free.value);
		return space.fits ? ok(undefined) : err(noSpaceError(space));
	}

	async #planNow(): Promise<Result<Planned>> {
		const { platform } = this.#deps;
		const copy = await platform.conductorImport.copy(conductorDatabasePath(platform.fs.paths.home));
		if (!copy.ok) return copy;
		const snapshot = await platform.conductorImport.read(copy.value.copyPath);
		if (!snapshot.ok) return snapshot;
		const { rows } = parseConductorRows(snapshot.value);
		const folders: Record<string, RepoFolder> = {};
		for (const repo of rows.repos) {
			const root = repo.root_path?.replace(/\/+$/, "");
			if (root === undefined || !root.startsWith("/") || folders[root] !== undefined) continue;
			const folder = await this.#readFolder(root);
			if (!folder.ok) return folder;
			folders[root] = folder.value;
		}
		const conducted = await this.#conductedState(
			rows.env_vars
				.filter((row) => row.context === "local" && row.has_value)
				.map((row) => envVarKeychainKey("global", row.key)),
		);
		if (!conducted.ok) return conducted;
		const chatDefaults = this.#deps.chatDefaults();
		if (!chatDefaults.ok) return chatDefaults;
		const plan = planConductorImport({
			snapshot: snapshot.value,
			workspacesRoot: this.#deps.workspacesRoot(),
			conducted: conducted.value,
			folders,
			offeredModels: await this.#deps.offeredModels(),
			chatDefaults: chatDefaults.value,
			now: this.#deps.now(),
		});
		const size = await measureChatHistories(plan.history, {
			conductorImport: platform.conductorImport,
			sidecar: this.#deps.sidecar,
			copyPath: copy.value.copyPath,
			now: this.#deps.now(),
			cancelled: () => this.#cancelled,
		});
		if (!size.ok) return size;
		const free = await platform.app.databaseFreeBytes();
		if (!free.ok) return free;
		const preview = { ...plan.preview, space: importSpace(size.value, free.value) };
		return ok({ copyPath: copy.value.copyPath, plan, size: size.value, preview });
	}

	/** What one repository folder holds, read only: the folder, its worktrees and settings files. */
	async #readFolder(root: string): Promise<Result<RepoFolder>> {
		const { fs } = this.#deps.platform;
		// The file commands reach a project's folder once it is registered, as the project
		// service registers every project it loads.
		const registered = await fs.registerRoot(root);
		if (!registered.ok) return registered;
		const empty: RepoFolder = {
			exists: false,
			worktrees: null,
			shared: null,
			local: null,
			unreadable: [],
			conductorJson: false,
			conductedShared: false,
			conductedLocal: false,
			scriptFiles: {},
		};
		if (!(await fs.exists(root))) return ok(empty);
		const listed = await this.#deps.git.stdout(worktreeList(), { cwd: root });
		const unreadable: string[] = [];
		const readToml = async (relative: string): Promise<SettingsFileContents | null> => {
			const path = `${root}/${relative}`;
			if (!(await fs.exists(path))) return null;
			const text = await fs.readText(path);
			const parsed = text.ok ? this.#deps.toml.parse(text.value) : null;
			if (parsed === null || !parsed.ok) {
				unreadable.push(relative);
				return null;
			}
			return parseSettingsDocument(parsed.value, path);
		};
		const shared = await readToml(".conductor/settings.toml");
		const local = await readToml(".conductor/settings.local.toml");
		const candidates = [
			...scriptFileCandidates(shared === null ? EMPTY_SCRIPTS : scriptsOf(shared)),
			...scriptFileCandidates(local === null ? EMPTY_SCRIPTS : scriptsOf(local)),
		];
		const scriptFiles: Record<string, string> = {};
		for (const relative of new Set(candidates)) {
			const path = `${root}/${relative}`;
			const facts = await fs.stat(path);
			if (!facts.ok || facts.value.isDirectory || facts.value.size > SCRIPT_FILE_LIMIT) continue;
			const text = await fs.readText(path);
			if (text.ok) scriptFiles[relative] = text.value;
		}
		return ok({
			exists: true,
			worktrees: listed.ok ? parseWorktreeList(listed.value) : null,
			shared,
			local,
			unreadable,
			conductorJson: await fs.exists(`${root}/conductor.json`),
			conductedShared: await fs.exists(sharedSettingsFile(root)),
			conductedLocal: await fs.exists(localSettingsFile(root)),
			scriptFiles,
		});
	}

	async #conductedState(keychainKeys: readonly string[]): Promise<Result<ConductedState>> {
		const repositories = this.#deps.repositories();
		const repos = await repositories.repos.list({ includeHidden: true });
		if (!repos.ok) return repos;
		const workspaces = await repositories.workspaces.listAll();
		if (!workspaces.ok) return workspaces;
		const ids = await readExistingIds(this.#deps.db);
		if (!ids.ok) return ids;
		const favorites = await repositories.favoriteModels.list();
		if (!favorites.ok) return favorites;
		const settings = await repositories.settings.list();
		if (!settings.ok) return settings;
		const envVars = await repositories.envVars.listGlobal();
		if (!envVars.ok) return envVars;
		const keychainKeysInUse = new Set<string>();
		const names = new Set(envVars.value.map((row) => row.name));
		for (const key of keychainKeys) {
			if (names.has(key.slice("env:global:".length))) continue;
			const held = await this.#deps.platform.keychain.get(key);
			if (!held.ok) return held;
			if (held.value !== null) keychainKeysInUse.add(key);
		}
		return ok({
			repos: repos.value,
			workspaces: workspaces.value,
			sessionIds: ids.value.sessionIds,
			sessionIdsWithEvents: ids.value.sessionIdsWithEvents,
			commentIds: ids.value.commentIds,
			sectionIds: ids.value.sectionIds,
			sectionCount: ids.value.sectionIds.size,
			favorites: favorites.value,
			settingKeys: new Set(settings.value.map((row) => row.key)),
			globalEnvVarNames: names,
			keychainKeysInUse,
		});
	}

	/** Writes one new settings file with the scripts, through the settings service's writer. */
	async #writeSettingsFile(file: SettingsFileWrite): Promise<Result<void>> {
		return this.#deps.settings.updateSettingsFile(file.path, "repo", (contents) => {
			for (const [key, value] of Object.entries(file.scripts.values)) {
				contents.values[key as SettingKey] = value;
			}
			for (const action of file.scripts.actions) contents.actions[action.id] = action;
		});
	}

	/**
	 * Keeps each new local settings file out of git, as saving a local setting does. It runs once
	 * the import has committed, so a rolled-back import leaves the repository's git files alone. A
	 * failure is a warning: the import itself stands.
	 */
	async #excludeLocalFiles(files: readonly SettingsFileWrite[]): Promise<void> {
		for (const file of files) {
			if (file.scope !== "local") continue;
			const excluded = await this.#deps.settings.excludeLocalSettingsFromGit(file.repoRootPath);
			if (!excluded.ok) {
				this.#deps.log("warn", `Git may not ignore ${file.path}: ${excluded.error.message}`);
			}
		}
	}
}
