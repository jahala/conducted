/**
 * @feature DATA-05 Settings store and settings files
 * Owns: reading and writing settings from their layers (registry default, the `settings` table,
 * `~/.conducted/settings.toml`, `.conducted/settings.toml`, `.conducted/settings.local.toml`),
 * deciding the effective value, and the environment variables whose values live in the Keychain.
 * Behaviour: services-map.md 4.2.1 (layers and precedence), 4.2.2 (scopes), 4.2.4 (settings.toml
 * schema, named actions, env var sections), 4.2.8 (env vars and secrets), ui-map.md 6,
 * 5A.1.6 (named actions and their ids), 2.5.2 (config reload on focus and every 30 s).
 * Must handle: precedence from lowest to highest is default, table, user file, remote default
 * branch, repo shared file, workspace shared file, repo local file; a key whose registry entry has
 * no repo scope ignores repo layers; an invalid TOML file never overwrites silently (the write
 * returns an Err with code `settings_file_invalid` and the UI offers "overwrite"); unknown keys,
 * wrong types and unsupported values are dropped and reported, never thrown; writes to the repo
 * shared file are refused in the UI (it is committed to git), personal repo edits go to the local
 * file; the local file is excluded from git through `info/exclude`; writes keep keys sorted and add
 * a `$schema` line; a settings write shows in the store at once (optimistic) and rolls back if the
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
import { localSettingsFile, sharedSettingsFile, userSettingsFile } from "../app-paths.ts";
import type { Repositories } from "../db/repositories.ts";
import {
	coerceSettingValue,
	getSettingDef,
	type SettingDef,
	type SettingValue,
	tomlKeys,
} from "../registries/settings.ts";

export interface TomlCodec {
	parse(text: string): Result<Record<string, unknown>>;
	stringify(value: Record<string, unknown>): string;
}

/** From lowest to highest precedence. */
export const SETTING_LAYERS = [
	"table",
	"user-file",
	"repo-remote",
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
	/** True only for a managed or feature-flag layer. This app has neither, so it is always false. */
	isLocked: boolean;
}

const REPO_LAYERS: ReadonlySet<SettingLayer> = new Set([
	"repo-remote",
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
		? { value: def.default as SettingValue, source: "default", isLocked: false }
		: { value: best.value, source: best.layer, isLocked: false };
}

// ---------------------------------------------------------------- messages

export const SETTINGS_FILE_INVALID_MESSAGE =
	"Can't save setting because your settings file is invalid";
export const SHARED_SETTINGS_READ_ONLY_MESSAGE =
	"Shared repository settings are read-only in Conductor. Edit the settings file directly.";
export const SETTINGS_LOAD_FAILED_MESSAGE = "Failed to load settings";
export const SETTINGS_SAVE_FAILED_MESSAGE = "Failed to save setting";
export const GIT_EXCLUDE_FAILED_MESSAGE =
	"Couldn't update Git to ignore your local settings file, it may not be excluded from commits";

/** Settings whose values must never be written to a log. */
export const SENSITIVE_SETTING_KEYS: readonly string[] = [
	"claude_executable_path",
	"codex_executable_path",
	"opencode_executable_path",
	"keybinding_overrides_v1",
];

/** A value safe to log for one setting. Secrets become a fixed marker. */
export const redactSettingForLog = (key: string, value: unknown): unknown =>
	SENSITIVE_SETTING_KEYS.includes(key) ? "[redacted]" : value;

// ---------------------------------------------------------------- toml values

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads a dotted key such as `models.default` from a parsed document. */
export function getTomlPath(root: Record<string, unknown>, path: string): unknown {
	let current: unknown = root;
	for (const part of path.split(".")) {
		if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
		current = current[part];
	}
	return current;
}

/** Writes a dotted key such as `models.default` into a parsed document. */
export function setTomlPath(root: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split(".");
	let current = root;
	for (let index = 0; index < parts.length - 1; index += 1) {
		const part = parts[index];
		if (part === undefined) return;
		const next = current[part];
		if (isRecord(next)) {
			current = next;
		} else {
			const created: Record<string, unknown> = {};
			current[part] = created;
			current = created;
		}
	}
	const last = parts.at(-1);
	if (last !== undefined) current[last] = value;
}

/** Sorted for a stable file. The action table keeps its order, as the research asks. */
function sortForWrite(value: unknown, path: string): unknown {
	if (Array.isArray(value)) return value.map((item) => sortForWrite(item, path));
	if (!isRecord(value)) return value;
	const keys = path === "scripts.run" ? Object.keys(value) : Object.keys(value).sort();
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		result[key] = sortForWrite(value[key], path === "" ? key : `${path}.${key}`);
	}
	return result;
}

/** The schema URL written into the first line of a settings file. */
export const settingsSchemaUrl = (scope: "user" | "repo"): string =>
	scope === "user"
		? "https://conducted.app/schemas/settings.schema.json"
		: "https://conducted.app/schemas/settings.repo.schema.json";

// ---------------------------------------------------------------- actions

export type ActionTarget = "local" | "cloud";

/** One named action from `[scripts.run.<id>]`, in our own shape. */
export interface SettingAction {
	id: string;
	command: string;
	args: readonly string[];
	/** Null means the workspace folder. */
	cwd: string | null;
	isDefault: boolean;
	hidden: boolean;
	icon: string | null;
	availableIn: readonly ActionTarget[];
}

/**
 * Trims an action id: drops a leading dash, turns dashes into spaces, removes anything that is
 * not a letter or digit, collapses spaces, then turns the spaces back into dashes.
 */
export function normalizeActionId(raw: string): string {
	return raw
		.replace(/^-+/, "")
		.replace(/-/g, " ")
		.replace(/[^A-Za-z0-9 ]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/ /g, "-");
}

/** Compares two action ids the way the product does: case-insensitive, after normalising. */
export const actionIdsEqual = (left: string, right: string): boolean =>
	normalizeActionId(left).toLowerCase() === normalizeActionId(right).toLowerCase();

/** A readable label from an action id: "my-dev-server" becomes "My dev server". */
export function actionLabel(id: string): string {
	const words = normalizeActionId(id).replace(/-/g, " ").split(" ").filter(Boolean);
	return words.map((word, index) => (index === 0 ? capitalize(word) : word)).join(" ");
}

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** A legacy single run script becomes the default local action named "run". */
export function legacyRunAction(command: string): SettingAction {
	return {
		id: "run",
		command,
		args: [],
		cwd: null,
		isDefault: true,
		hidden: false,
		icon: "play",
		availableIn: ["local"],
	};
}

function parseActionTargets(
	value: unknown,
	file: string,
	key: string,
	dropped: DroppedSetting[],
): readonly ActionTarget[] | null {
	if (value === undefined) return ["local", "cloud"];
	const single = (input: unknown): ActionTarget | null => {
		if (input === "local" || input === "cloud") return input;
		dropped.push({ file, key, reason: "unsupported-value" });
		return null;
	};
	if (Array.isArray(value)) {
		const result: ActionTarget[] = [];
		for (const entry of value) {
			const target = single(entry);
			if (target === null) return null;
			result.push(target);
		}
		return result;
	}
	const target = single(value);
	return target === null ? null : [target];
}

function parseAction(
	id: string,
	raw: unknown,
	file: string,
	dropped: DroppedSetting[],
): SettingAction | null {
	if (!isRecord(raw)) {
		dropped.push({ file, key: `scripts.run.${id}`, reason: "wrong-type" });
		return null;
	}
	const command = raw["command"];
	if (typeof command !== "string") {
		dropped.push({ file, key: `scripts.run.${id}.command`, reason: "wrong-type" });
		return null;
	}
	const args: string[] = [];
	const rawArgs = raw["args"];
	if (rawArgs !== undefined) {
		if (Array.isArray(rawArgs) && rawArgs.every((entry) => typeof entry === "string")) {
			for (const entry of rawArgs) args.push(entry);
		} else {
			dropped.push({ file, key: `scripts.run.${id}.args`, reason: "wrong-type" });
		}
	}
	const options = raw["options"];
	const rawCwd = isRecord(options) ? options["cwd"] : undefined;
	let cwd: string | null = null;
	if (typeof rawCwd === "string") cwd = rawCwd;
	else if (rawCwd !== undefined) {
		dropped.push({ file, key: `scripts.run.${id}.options.cwd`, reason: "wrong-type" });
	}
	const rawDefault = raw["default"];
	const isDefault = typeof rawDefault === "boolean" ? rawDefault : false;
	if (rawDefault !== undefined && typeof rawDefault !== "boolean") {
		dropped.push({ file, key: `scripts.run.${id}.default`, reason: "wrong-type" });
	}
	const rawHide = raw["hide"];
	const hidden = typeof rawHide === "boolean" ? rawHide : false;
	if (rawHide !== undefined && typeof rawHide !== "boolean") {
		dropped.push({ file, key: `scripts.run.${id}.hide`, reason: "wrong-type" });
	}
	const rawIcon = raw["icon"];
	const icon = typeof rawIcon === "string" ? rawIcon : null;
	if (rawIcon !== undefined && typeof rawIcon !== "string") {
		dropped.push({ file, key: `scripts.run.${id}.icon`, reason: "wrong-type" });
	}
	const availableIn = parseActionTargets(
		raw["available_in"],
		file,
		`scripts.run.${id}.available_in`,
		dropped,
	);
	if (availableIn === null) return null;
	const allowed = new Set([
		"command",
		"args",
		"options",
		"default",
		"icon",
		"hide",
		"available_in",
	]);
	for (const key of Object.keys(raw)) {
		if (!allowed.has(key)) {
			dropped.push({ file, key: `scripts.run.${id}.${key}`, reason: "unknown-key" });
		}
	}
	return {
		id,
		command,
		args,
		cwd,
		isDefault,
		hidden,
		icon,
		availableIn,
	};
}

/**
 * Merges action layers per id. Later layers win field-by-field; an action keeps the position it
 * first appeared at. Comparison is case-insensitive.
 */
export function mergeSettingActions(
	layers: readonly (readonly SettingAction[] | undefined)[],
): SettingAction[] {
	const byId = new Map<string, SettingAction>();
	for (const layer of layers) {
		if (layer === undefined) continue;
		for (const action of layer) {
			const existingKey = [...byId.keys()].find((id) => actionIdsEqual(id, action.id));
			if (existingKey === undefined) {
				byId.set(action.id, { ...action });
				continue;
			}
			const previous = byId.get(existingKey);
			if (previous === undefined) continue;
			byId.set(existingKey, {
				...previous,
				...action,
				id: existingKey,
			});
		}
	}
	return [...byId.values()];
}

/** Parses `scripts.run` (a string or a table) and the legacy top-level `tasks` table. */
function parseActionSection(
	raw: unknown,
	file: string,
	dropped: DroppedSetting[],
): { actions: SettingAction[]; legacyRun: string | null } {
	if (raw === undefined) return { actions: [], legacyRun: null };
	if (typeof raw === "string") return { actions: [legacyRunAction(raw)], legacyRun: raw };
	if (!isRecord(raw)) {
		dropped.push({ file, key: "scripts.run", reason: "wrong-type" });
		return { actions: [], legacyRun: null };
	}
	const actions: SettingAction[] = [];
	for (const [id, value] of Object.entries(raw)) {
		const action = parseAction(id, value, file, dropped);
		if (action !== null) actions.push(action);
	}
	return { actions, legacyRun: null };
}

// ---------------------------------------------------------------- environment variables

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

/** A settings file's sentinel for "this value is in the Keychain". */
export const ENV_VAR_KEYCHAIN_MARKER = "conductor-keychain";
/** A settings file's sentinel for "remove the inherited value". */
export const ENV_VAR_NONE_MARKER = "<none>";

export type EnvVarScope = "all" | "local" | "cloud";
export type EnvVarMarker = "value" | "keychain" | "none";

export interface FileEnvVar {
	name: string;
	scope: EnvVarScope;
	marker: EnvVarMarker;
	/** Only set when the marker is "value". Keychain values never enter the file. */
	value: string | null;
}

function parseEnvVars(
	raw: unknown,
	file: string,
	dropped: DroppedSetting[],
): Record<string, FileEnvVar> {
	const result: Record<string, FileEnvVar> = {};
	if (raw === undefined) return result;
	if (!isRecord(raw)) {
		dropped.push({ file, key: "environment_variables", reason: "wrong-type" });
		return result;
	}
	const take = (value: unknown, scope: EnvVarScope, prefix: string): void => {
		if (!isRecord(value)) {
			dropped.push({ file, key: prefix, reason: "wrong-type" });
			return;
		}
		for (const [name, entry] of Object.entries(value)) {
			if (!ENV_VAR_NAME.test(name)) {
				dropped.push({ file, key: `${prefix}.${name}`, reason: "unsupported-value" });
				continue;
			}
			if (typeof entry !== "string") {
				dropped.push({ file, key: `${prefix}.${name}`, reason: "wrong-type" });
				continue;
			}
			let marker: EnvVarMarker = "value";
			let stored: string | null = entry;
			if (entry === ENV_VAR_KEYCHAIN_MARKER) {
				marker = "keychain";
				stored = null;
			} else if (entry === ENV_VAR_NONE_MARKER) {
				marker = "none";
				stored = null;
			}
			result[`${scope}:${name}`] = { name, scope, marker, value: stored };
		}
	};
	const topLevel: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(raw)) {
		if (key === "local" || key === "cloud") {
			take(entry, key, `environment_variables.${key}`);
		} else {
			topLevel[key] = entry;
		}
	}
	take(topLevel, "all", "environment_variables");
	return result;
}

// ---------------------------------------------------------------- file shapes

export type DroppedReason = "unreadable-file" | "unknown-key" | "wrong-type" | "unsupported-value";

export interface DroppedSetting {
	file: string;
	key: string;
	reason: DroppedReason;
}

export interface SettingsWarning {
	code: string;
	message: string;
}

export interface SettingsFileContents {
	file: string;
	values: Record<string, SettingValue>;
	actions: Record<string, SettingAction>;
	envVars: Record<string, FileEnvVar>;
	dropped: DroppedSetting[];
}

const TOML_KEY_TO_SETTING: Readonly<Record<string, string>> = tomlKeys();

const emptyContents = (file: string): SettingsFileContents => ({
	file,
	values: {},
	actions: {},
	envVars: {},
	dropped: [],
});

function dropReasonFromError(message: string): DroppedReason {
	return message.includes("must be one of") ? "unsupported-value" : "wrong-type";
}

function* leaves(value: unknown, prefix: string): Generator<{ path: string; value: unknown }> {
	if (isRecord(value)) {
		for (const [key, child] of Object.entries(value)) {
			yield* leaves(child, prefix === "" ? key : `${prefix}.${key}`);
		}
		return;
	}
	yield { path: prefix, value };
}

/** Turns a parsed TOML document into settings values, actions and env vars. */
export function parseSettingsDocument(
	document: Record<string, unknown>,
	file: string,
): SettingsFileContents {
	const contents = emptyContents(file);

	const scripts = document["scripts"];
	const run = isRecord(scripts) ? scripts["run"] : undefined;
	const fromRun = parseActionSection(run, file, contents.dropped);
	const fromTasks = parseActionSection(document["tasks"], file, contents.dropped);
	const legacyRun = fromRun.legacyRun ?? fromTasks.legacyRun;
	for (const action of [...fromRun.actions, ...fromTasks.actions]) {
		contents.actions[action.id] = action;
	}

	const envRaw = document["environment_variables"] ?? document["environmentVariables"];
	contents.envVars = parseEnvVars(envRaw, file, contents.dropped);

	for (const leaf of leaves(document, "")) {
		const path = leaf.path;
		if (
			path === "$schema" ||
			path === "tasks" ||
			path.startsWith("tasks.") ||
			path === "environment_variables" ||
			path.startsWith("environment_variables.") ||
			path === "environmentVariables" ||
			path.startsWith("environmentVariables.") ||
			path === "scripts" ||
			path === "scripts.run" ||
			path.startsWith("scripts.run.")
		) {
			continue;
		}
		const key = TOML_KEY_TO_SETTING[path];
		if (key === undefined) {
			contents.dropped.push({ file, key: path, reason: "unknown-key" });
			continue;
		}
		const def = getSettingDef(key);
		if (def === undefined) {
			contents.dropped.push({ file, key: path, reason: "unknown-key" });
			continue;
		}
		const coerced = coerceSettingValue(def, leaf.value);
		if (!coerced.ok) {
			contents.dropped.push({
				file,
				key: path,
				reason: dropReasonFromError(coerced.error.message),
			});
			continue;
		}
		contents.values[def.key] = coerced.value;
	}
	if (legacyRun !== null) {
		const def = getSettingDef("run_script");
		if (def !== undefined) contents.values[def.key] = legacyRun;
	}
	return contents;
}

/** Builds the document a settings file gets on write: a schema line and no unknown keys. */
export function buildSettingsDocument(
	contents: SettingsFileContents,
	scope: "user" | "repo",
): Record<string, unknown> {
	const document: Record<string, unknown> = { $schema: settingsSchemaUrl(scope) };
	for (const [key, value] of Object.entries(contents.values)) {
		const def = getSettingDef(key);
		if (def?.tomlKey === undefined) continue;
		if (def.tomlKey === "scripts.run" && Object.keys(contents.actions).length > 0) continue;
		setTomlPath(document, def.tomlKey, value);
	}
	if (Object.keys(contents.actions).length > 0) {
		for (const action of Object.values(contents.actions)) {
			const table: Record<string, unknown> = { command: action.command };
			if (action.args.length > 0) table["args"] = [...action.args];
			if (action.cwd !== null) table["options"] = { cwd: action.cwd };
			if (action.isDefault) table["default"] = true;
			if (action.icon !== null) table["icon"] = action.icon;
			if (action.hidden) table["hide"] = true;
			table["available_in"] = [...action.availableIn];
			setTomlPath(document, `scripts.run.${action.id}`, table);
		}
	}
	const envGroups: {
		all: Record<string, string>;
		local: Record<string, string>;
		cloud: Record<string, string>;
	} = { all: {}, local: {}, cloud: {} };
	for (const envVar of Object.values(contents.envVars)) {
		const group = envGroups[envVar.scope];
		if (group === undefined) continue;
		group[envVar.name] =
			envVar.marker === "keychain"
				? ENV_VAR_KEYCHAIN_MARKER
				: envVar.marker === "none"
					? ENV_VAR_NONE_MARKER
					: (envVar.value ?? "");
	}
	if (Object.keys(envGroups.all).length > 0) {
		document["environment_variables"] = { ...envGroups.all };
	}
	if (Object.keys(envGroups.local).length > 0) {
		const parent = isRecord(document["environment_variables"])
			? document["environment_variables"]
			: {};
		parent["local"] = { ...envGroups.local };
		document["environment_variables"] = parent;
	}
	if (Object.keys(envGroups.cloud).length > 0) {
		const parent = isRecord(document["environment_variables"])
			? document["environment_variables"]
			: {};
		parent["cloud"] = { ...envGroups.cloud };
		document["environment_variables"] = parent;
	}
	return sortForWrite(document, "") as Record<string, unknown>;
}

// ---------------------------------------------------------------- service

export interface SettingsState {
	loaded: boolean;
	/** Effective user-level values for every key that has been read or written. */
	values: Readonly<Record<string, SettingValue>>;
	/** Entries dropped while reading files, shown on the diagnostics page. */
	dropped: readonly DroppedSetting[];
	/** Load or exclude problems the app shows but does not stop for. */
	warnings: readonly SettingsWarning[];
}

export type SettingsPlatform = Pick<Platform, "fs" | "keychain" | "app"> & {
	shell?: Pick<Platform["shell"], "run">;
	window?: Pick<Platform["window"], "onFocusChanged">;
};

export interface SettingsServiceDeps {
	platform: SettingsPlatform;
	repos: Pick<Repositories, "settings" | "envVars">;
	toml: TomlCodec;
}

export interface SetOptions {
	/** Replace an invalid file instead of refusing the write. The UI offers this as "Overwrite file". */
	overwrite?: boolean;
}

export interface SetForRepoOptions extends SetOptions {
	/** The shared file is committed, so the app never writes it. */
	target?: "local" | "shared";
}

/** While a managed settings file or a feature flag existed, this would be true for those keys. */
const RELOAD_INTERVAL_MS = 30_000;

export class SettingsService {
	readonly store: StoreApi<SettingsState>;
	readonly #deps: SettingsServiceDeps;
	readonly #writeChains = new Map<string, Promise<unknown>>();
	#unsubscribeFocus: (() => void) | null = null;
	#reloadTimer: ReturnType<typeof setInterval> | null = null;

	constructor(deps: SettingsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SettingsState>(() => ({
			loaded: false,
			values: {},
			dropped: [],
			warnings: [],
		}));
	}

	/** Loads the table rows and the user file. Runs first at startup; every other service reads settings. */
	async start(): Promise<Result<void>> {
		await this.reloadFromDisk();
		this.#startReloading();
		return ok(undefined);
	}

	/** Reads the user file and the table again. Called on window focus and every 30 s. */
	async reloadFromDisk(): Promise<Result<void>> {
		const dropped: DroppedSetting[] = [];
		const warnings: SettingsWarning[] = [];
		const values: Record<string, SettingValue> = {};

		const rows = await this.#deps.repos.settings.list();
		if (!rows.ok) {
			warnings.push({ code: "settings_load_failed", message: SETTINGS_LOAD_FAILED_MESSAGE });
		} else {
			for (const row of rows.value) {
				const def = getSettingDef(row.key);
				if (def === undefined || def.tomlKey !== undefined) continue;
				const coerced = coerceSettingValue(def, row.value);
				if (coerced.ok) values[def.key] = coerced.value;
				else {
					dropped.push({
						file: "settings",
						key: row.key,
						reason: dropReasonFromError(coerced.error.message),
					});
				}
			}
		}

		const userFile = this.#userFile();
		const file = await this.readSettingsFile(userFile);
		if (file.ok) {
			for (const [key, value] of Object.entries(file.value.values)) {
				const def = getSettingDef(key);
				if (def?.tomlKey !== undefined) values[key] = value;
			}
			dropped.push(...file.value.dropped);
		} else {
			dropped.push({ file: userFile, key: userFile, reason: "unreadable-file" });
			warnings.push({ code: "settings_load_failed", message: SETTINGS_LOAD_FAILED_MESSAGE });
		}

		this.store.setState({ loaded: true, values, dropped, warnings });
		return ok(undefined);
	}

	/** Backs `useSetting`. Uses the registry default until a value is known. */
	get<T>(key: string): T {
		const def = getSettingDef(key);
		const stored = this.store.getState().values[key];
		if (stored !== undefined && stored !== null) return stored as T;
		if (def === undefined) return undefined as T;
		return (def.type === "string-list" ? [...def.default] : def.default) as T;
	}

	/** Effective value for one repository, with the layer it came from. */
	async getForRepo(
		key: string,
		repoRootPath: string,
		workspacePath: string | null,
	): Promise<Result<ResolvedSetting>> {
		const def = getSettingDef(key);
		if (def === undefined) return err(appError("setting_unknown", `Unknown setting "${key}".`));

		const layers: LayerValue[] = [];
		const fromTable = this.store.getState().values[key];
		if (fromTable !== undefined && fromTable !== null) {
			layers.push({ layer: "table", value: fromTable });
		}
		if (def.tomlKey !== undefined) {
			const userLayer = await this.#layerValue(this.#userFile(), def);
			if (userLayer !== null) layers.push({ layer: "user-file", value: userLayer });

			if (def.scopes.includes("repo") && def.fileLayers === "user-and-repo") {
				const remote = await this.#remoteLayer(repoRootPath, def);
				if (remote !== null) layers.push({ layer: "repo-remote", value: remote });

				const shared = await this.#layerValue(sharedSettingsFile(repoRootPath), def);
				if (shared !== null) layers.push({ layer: "repo-shared", value: shared });

				if (workspacePath !== null) {
					const workspace = await this.#layerValue(sharedSettingsFile(workspacePath), def);
					if (workspace !== null) layers.push({ layer: "workspace-shared", value: workspace });
				}

				const local = await this.#layerValue(localSettingsFile(repoRootPath), def);
				if (local !== null) layers.push({ layer: "repo-local", value: local });
			}
		}
		return ok(resolveSetting(def, layers));
	}

	/** Backs `Actions.settings.set`. Validates with the registry, then writes to the right place. */
	async set(key: string, value: unknown, options: SetOptions = {}): Promise<Result<void>> {
		const def = getSettingDef(key);
		if (def === undefined) return err(appError("setting_unknown", `Unknown setting "${key}".`));
		const coerced = coerceSettingValue(def, value);
		if (!coerced.ok) return coerced;
		if (def.tomlKey === undefined) return this.#setInTable(def, coerced.value);
		return this.#setInFile(
			this.#userFile(),
			"user",
			def,
			coerced.value,
			options.overwrite === true,
			key,
		);
	}

	/** Writes a repo-scoped key into `.conducted/settings.local.toml` of the repository. */
	async setForRepo(
		repoRootPath: string,
		key: string,
		value: unknown,
		options: SetForRepoOptions = {},
	): Promise<Result<void>> {
		const def = getSettingDef(key);
		if (def === undefined) return err(appError("setting_unknown", `Unknown setting "${key}".`));
		if (!def.scopes.includes("repo") || def.fileLayers !== "user-and-repo") {
			return err(appError("setting_not_repo_scoped", `"${key}" cannot be set for one repository.`));
		}
		if (options.target === "shared") {
			return err(appError("settings_shared_read_only", SHARED_SETTINGS_READ_ONLY_MESSAGE));
		}
		const coerced = coerceSettingValue(def, value);
		if (!coerced.ok) return coerced;
		const written = await this.#setInFile(
			localSettingsFile(repoRootPath),
			"repo",
			def,
			coerced.value,
			options.overwrite === true,
			key,
		);
		if (!written.ok) return written;
		const exclude = await this.#ensureGitExclude(repoRootPath);
		if (!exclude.ok) {
			const warning = { code: "git_exclude_failed", message: GIT_EXCLUDE_FAILED_MESSAGE };
			this.store.setState({
				warnings: [
					...this.store.getState().warnings.filter((w) => w.code !== warning.code),
					warning,
				],
			});
		}
		return ok(undefined);
	}

	/** Reads one TOML settings file into a plain value map plus the entries that were dropped. */
	async readSettingsFile(path: string): Promise<Result<SettingsFileContents>> {
		if (!(await this.#deps.platform.fs.exists(path))) return ok(emptyContents(path));
		const text = await this.#deps.platform.fs.readText(path);
		if (!text.ok) {
			return err(appError("settings_file_unreadable", `Could not read ${path}.`, text.error));
		}
		const parsed = this.#deps.toml.parse(text.value);
		if (!parsed.ok) {
			return err(appError("settings_file_invalid", SETTINGS_FILE_INVALID_MESSAGE, parsed.error));
		}
		return ok(parseSettingsDocument(parsed.value, path));
	}

	/** Stops the reload timer and the window focus listener. */
	stop(): void {
		this.#unsubscribeFocus?.();
		this.#unsubscribeFocus = null;
		if (this.#reloadTimer !== null) {
			clearInterval(this.#reloadTimer);
			this.#reloadTimer = null;
		}
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

	// -------------------------------------------------------------- internals

	#userFile(): string {
		return userSettingsFile(this.#deps.platform.fs.paths);
	}

	#startReloading(): void {
		if (this.#unsubscribeFocus === null) {
			const window = this.#deps.platform.window;
			if (window !== undefined) {
				this.#unsubscribeFocus = window.onFocusChanged((focused) => {
					if (focused) void this.reloadFromDisk();
				});
			}
		}
		if (this.#reloadTimer === null) {
			const timer = setInterval(async () => {
				await this.reloadFromDisk();
			}, RELOAD_INTERVAL_MS);
			(timer as unknown as { unref?: () => void }).unref?.();
			this.#reloadTimer = timer;
		}
	}

	async #layerValue(file: string, def: SettingDef): Promise<SettingValue | null> {
		const result = await this.readSettingsFile(file);
		if (!result.ok) return null;
		if (def.tomlKey === undefined) return null;
		const value = result.value.values[def.key];
		return value === undefined ? null : value;
	}

	async #remoteLayer(repoRootPath: string, def: SettingDef): Promise<SettingValue | null> {
		const shell = this.#deps.platform.shell;
		if (shell === undefined || def.tomlKey === undefined) return null;
		const head = await shell.run({
			program: "git",
			args: ["-C", repoRootPath, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
			cwd: repoRootPath,
		});
		if (!head.ok || head.value.exitCode !== 0) return null;
		const branch = head.value.stdout.trim().replace(/^refs\/remotes\//, "");
		if (branch === "") return null;
		const show = await shell.run({
			program: "git",
			args: ["-C", repoRootPath, "show", `${branch}:.conducted/settings.toml`],
			cwd: repoRootPath,
		});
		if (!show.ok || show.value.exitCode !== 0) return null;
		const parsed = this.#deps.toml.parse(show.value.stdout);
		if (!parsed.ok) return null;
		const contents = parseSettingsDocument(parsed.value, `${branch}:.conducted/settings.toml`);
		const value = contents.values[def.key];
		return value === undefined ? null : value;
	}

	#enqueue(file: string, work: () => Promise<Result<void>>): Promise<Result<void>> {
		const previous = this.#writeChains.get(file) ?? Promise.resolve();
		const next = previous.then(work, work);
		this.#writeChains.set(file, next);
		void next.finally(() => {
			if (this.#writeChains.get(file) === next) this.#writeChains.delete(file);
		});
		return next;
	}

	async #setInTable(def: SettingDef, value: SettingValue): Promise<Result<void>> {
		const previous = this.store.getState().values[def.key];
		this.#setValue(def.key, value);
		const written = await this.#deps.repos.settings.set(def.key, value);
		if (!written.ok) {
			this.#restoreValue(def.key, previous);
			return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
		}
		return ok(undefined);
	}

	#setInFile(
		file: string,
		scope: "user" | "repo",
		def: SettingDef,
		value: SettingValue,
		overwrite: boolean,
		key: string,
	): Promise<Result<void>> {
		const previous = this.store.getState().values[key];
		this.#setValue(key, value);
		return this.#enqueue(file, async () => {
			const existing = await this.readSettingsFile(file);
			let contents: SettingsFileContents;
			if (existing.ok) {
				contents = existing.value;
			} else if (overwrite) {
				contents = emptyContents(file);
			} else {
				this.#restoreValue(key, previous);
				return err(
					appError(
						"settings_file_invalid",
						existing.error.code === "settings_file_invalid"
							? SETTINGS_FILE_INVALID_MESSAGE
							: `Could not read ${file}.`,
						existing.error,
					),
				);
			}
			if (value === null) {
				delete contents.values[key];
			} else {
				contents.values[key] = value;
			}
			const document = buildSettingsDocument(contents, scope);
			const text = this.#deps.toml.stringify(document);
			const written = await this.#deps.platform.fs.writeTextAtomic(file, text);
			if (!written.ok) {
				this.#restoreValue(key, previous);
				return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
			}
			return ok(undefined);
		});
	}

	#setValue(key: string, value: SettingValue): void {
		this.store.setState({ values: { ...this.store.getState().values, [key]: value } });
	}

	#restoreValue(key: string, previous: SettingValue | undefined): void {
		const values = { ...this.store.getState().values };
		if (previous === undefined) delete values[key];
		else values[key] = previous;
		this.store.setState({ values });
	}

	async #ensureGitExclude(repoRootPath: string): Promise<Result<void>> {
		const fs = this.#deps.platform.fs;
		const excludePath = `${repoRootPath.replace(/\/+$/, "")}/.git/info/exclude`;
		const lines = ["/.conducted/*", "!.conducted/settings.toml"];
		let text = "";
		if (await fs.exists(excludePath)) {
			const read = await fs.readText(excludePath);
			if (!read.ok) return read;
			text = read.value;
		} else {
			const made = await fs.mkdirp(`${repoRootPath.replace(/\/+$/, "")}/.git/info`);
			if (!made.ok) return made;
		}
		const current = text.split("\n");
		const missing = lines.filter((line) => !current.includes(line));
		if (missing.length === 0) return ok(undefined);
		const separator = text === "" || text.endsWith("\n") ? "" : "\n";
		const next = `${text}${separator}${missing.join("\n")}\n`;
		return fs.writeTextAtomic(excludePath, next);
	}
}
