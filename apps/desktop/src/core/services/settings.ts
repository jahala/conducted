/**
 * @feature DATA-05 Settings store and settings files
 * Owns: reading and writing settings from their layers (registry default, the `settings` table,
 * `~/.conducted/settings.toml`, `.conducted/settings.toml`, `.conducted/settings.local.toml`),
 * deciding the effective value, and the environment variables whose values live in the Keychain.
 * Behaviour: services-map.md 4.2.1 (layers and precedence), 4.2.2 (scopes), 4.2.4 (settings.toml
 * schema, named actions, env var sections), 4.2.8 (env vars and secrets), ui-map.md 6.
 * Must handle: precedence from lowest to highest is default, table, user file, repo shared file,
 * workspace shared file, repo local file; a key whose registry entry has no repo scope ignores
 * repo layers; an invalid TOML file never overwrites silently (the write returns an Err with
 * code `settings_file_invalid` and the UI offers "overwrite"); unknown keys, wrong types and
 * unsupported values are dropped and reported, never thrown; writes to the repo shared file are
 * refused in the UI (it is committed to git), personal repo edits go to the local file; the
 * local file is excluded from git through `info/exclude`; writes keep keys sorted and add a
 * `$schema` line; a settings write shows in the store at once (optimistic) and rolls back if the
 * file write fails; two writes to one file run one after the other; env var values never reach
 * a log or the `settings` table.
 * Our design choice: file-backed keys (the ones with a `tomlKey` in the registry) live only in
 * TOML files; every other key lives in the `settings` table. There is no legacy `conductor.json`
 * migration. The TOML parser is passed in (`TomlCodec`) so tests and the app can differ.
 * Test first: a repo shared value beats the user file for a repo-scoped key, and is ignored for a
 * user-only key.
 */
import { appError, err, notImplemented, ok, type RepoId, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { Repositories } from "../db/repositories.ts";
import type { SettingDef, SettingValue } from "../registries/settings.ts";

export interface TomlCodec {
	parse(text: string): Result<Record<string, unknown>>;
	stringify(value: Record<string, unknown>): string;
}

/** From lowest to highest precedence. */
export const SETTING_LAYERS = [
	"table",
	"user-file",
	"repo-shared",
	"workspace-shared",
	"repo-local",
] as const;
export type SettingLayer = (typeof SETTING_LAYERS)[number];

export interface LayerValue {
	layer: SettingLayer;
	value: SettingValue;
}

export interface ResolvedSetting {
	value: SettingValue;
	/** The layer that supplied the value, or "default". */
	source: SettingLayer | "default";
}

const REPO_LAYERS: ReadonlySet<SettingLayer> = new Set([
	"repo-shared",
	"workspace-shared",
	"repo-local",
]);

/**
 * Picks the effective value. `layers` may come in any order and may be sparse; precedence comes
 * from `SETTING_LAYERS`. Repo layers only count for keys that allow a repo scope in both
 * `scopes` and `fileLayers`.
 */
export function resolveSetting(def: SettingDef, layers: readonly LayerValue[]): ResolvedSetting {
	const repoAllowed = def.scopes.includes("repo") && def.fileLayers === "user-and-repo";
	let best: { rank: number; layer: SettingLayer; value: SettingValue } | null = null;
	for (const entry of layers) {
		if (REPO_LAYERS.has(entry.layer) && !repoAllowed) continue;
		if (entry.layer === "user-file" && def.tomlKey === undefined) continue;
		if (entry.layer === "table" && def.tomlKey !== undefined) continue;
		const rank = SETTING_LAYERS.indexOf(entry.layer);
		if (best === null || rank >= best.rank) best = { rank, layer: entry.layer, value: entry.value };
	}
	return best === null
		? { value: def.default as SettingValue, source: "default" }
		: { value: best.value, source: best.layer };
}

/** Name rule for environment variables. */
export const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const validateEnvVarName = (name: string): Result<string> =>
	ENV_VAR_NAME.test(name)
		? ok(name)
		: err(
				appError(
					"env_name_invalid",
					"Names use letters, digits and underscores, and do not start with a digit.",
				),
			);

/** Keychain entry that holds one environment variable's value. Our design choice for the key. */
export const envVarKeychainKey = (scope: "global" | { repoId: RepoId }, name: string): string =>
	`env:${scope === "global" ? "global" : `repo:${scope.repoId}`}:${name}`;

export interface SettingsState {
	loaded: boolean;
	/** Effective user-level values for every key that has been read or written. */
	values: Readonly<Record<string, SettingValue>>;
	/** Entries dropped while reading files, shown on the diagnostics page. */
	dropped: readonly {
		file: string;
		key: string;
		reason: "unreadable-file" | "unknown-key" | "wrong-type" | "unsupported-value";
	}[];
}

export interface SettingsServiceDeps {
	platform: Pick<Platform, "fs" | "keychain" | "app">;
	repos: Pick<Repositories, "settings" | "envVars">;
	toml: TomlCodec;
}

export class SettingsService {
	readonly store: StoreApi<SettingsState>;
	readonly #deps: SettingsServiceDeps;

	constructor(deps: SettingsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SettingsState>(() => ({ loaded: false, values: {}, dropped: [] }));
	}

	/** Loads the table rows and the user file. Runs first at startup; every other service reads settings. */
	start(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("DATA-05");
	}

	/** Backs `useSetting`. */
	get<T>(_key: string): T {
		return notImplemented("DATA-05");
	}

	/** Effective value for one repository, with the layer it came from. */
	getForRepo(
		_key: string,
		_repoRootPath: string,
		_workspacePath: string | null,
	): Promise<Result<ResolvedSetting>> {
		return notImplemented("DATA-05");
	}

	/** Backs `Actions.settings.set`. Validates with the registry, then writes to the right place. */
	set(_key: string, _value: unknown): Promise<Result<void>> {
		return notImplemented("DATA-05");
	}

	/** Writes a repo-scoped key into `.conducted/settings.local.toml` of the repository. */
	setForRepo(_repoRootPath: string, _key: string, _value: unknown): Promise<Result<void>> {
		return notImplemented("DATA-05");
	}

	/** Reads one TOML settings file into a plain value map plus the entries that were dropped. */
	readSettingsFile(
		_path: string,
	): Promise<Result<{ values: Record<string, SettingValue>; actions: unknown }>> {
		return notImplemented("DATA-05");
	}

	/** Backs `Actions.settings.setEnvVar`: value into the Keychain, name and scope into `env_vars`. */
	setEnvVar(
		_name: string,
		_value: string,
		_scope: "global" | { repoId: RepoId },
	): Promise<Result<void>> {
		return notImplemented("SET-04");
	}

	removeEnvVar(_name: string, _scope: "global" | { repoId: RepoId }): Promise<Result<void>> {
		return notImplemented("SET-04");
	}

	/** Environment for an agent or script of one repository: global, then repo values. */
	environmentFor(_repoId: RepoId): Promise<Result<Record<string, string>>> {
		return notImplemented("SET-04");
	}
}
