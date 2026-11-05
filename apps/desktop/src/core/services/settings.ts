/**
 * @feature DATA-05 Settings store and settings files
 * Owns: reading and writing settings from their layers (registry default, the `settings` table,
 * `~/.conducted/settings.toml`, `.conducted/settings.toml`, `.conducted/settings.local.toml`),
 * deciding the effective value, and parsing the environment variable tables of a settings file
 * (names and markers). The Keychain values behind those names belong to SET-04.
 * Behaviour: services-map.md 4.2.1 (layers and precedence), 4.2.2 (scopes), 4.2.4 (settings.toml
 * schema, named actions, env var sections), ui-map.md 6, 5A.1.6 (named actions and their ids),
 * 2.5.2 (config reload on focus and every 30 s).
 * Must handle: precedence from lowest to highest is default, table, user file, remote default
 * branch, repo shared file, workspace shared file, repo local file; a key whose registry entry has
 * no repo scope ignores repo layers; an invalid TOML file never overwrites silently (the write
 * returns an Err with code `settings_file_invalid` and the UI offers "overwrite"); unknown keys,
 * wrong types and unsupported values are dropped and reported, never thrown; a later write does
 * not undo an earlier one that failed; writes keep unknown entries, sorted keys and a `$schema`
 * line; a settings write shows in the store at once (optimistic) and rolls back if the file write
 * fails; two writes to one file run one after the other; values of sensitive settings are redacted
 * before they reach a log.
 * Our design choice: file-backed keys (the ones with a `tomlKey` in the registry) live only in
 * TOML files; every other key lives in the `settings` table. There is no legacy `conductor.json`
 * migration. The TOML parser is passed in (`TomlCodec`) so tests and the app can differ. Per-user
 * hidden action ids belong to SET-07's file store, not to a settings file.
 * Test first: a repo shared value beats the user file for a repo-scoped key, and is ignored for a
 * user-only key.
 */
import { appError, err, notImplemented, ok, type RepoId, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import { localSettingsFile, sharedSettingsFile, userSettingsFile } from "../app-paths.ts";
import { createKeyedQueue, type KeyedQueue } from "../async/serial-queue.ts";
import type { Repositories } from "../db/repositories.ts";
import { showSettingsFileAt, symbolicRefRemoteHead } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	coerceSettingValue,
	getSettingDef,
	SETTINGS,
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
	/** Entries one of the layer files could not use. Present only when there are some. */
	dropped?: readonly DroppedSetting[];
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

/**
 * One named action from `[scripts.run.<id>]`, in our own shape. Every field except `id` and
 * `command` is absent when the layer that supplied the action did not set it, so a later layer
 * that changes only `command` keeps the earlier layer's other fields.
 */
export interface SettingAction {
	id: string;
	command: string;
	args?: readonly string[];
	/** Only a string is set in a file; null in the resolved shape means the workspace folder. */
	cwd?: string | null;
	isDefault?: boolean;
	hidden?: boolean;
	icon?: string | null;
	availableIn?: readonly ActionTarget[];
}

/** A merged action with the research defaults filled in. */
export interface ResolvedSettingAction {
	id: string;
	command: string;
	args: readonly string[];
	cwd: string | null;
	isDefault: boolean;
	hidden: boolean;
	icon: string | null;
	availableIn: readonly ActionTarget[];
}

/** Fills the defaults the research gives an action when no layer said otherwise. */
export function resolveSettingAction(action: SettingAction): ResolvedSettingAction {
	return {
		...action,
		args: action.args ?? [],
		cwd: action.cwd ?? null,
		isDefault: action.isDefault ?? false,
		hidden: action.hidden ?? false,
		icon: action.icon ?? null,
		availableIn: action.availableIn ?? ["local", "cloud"],
	};
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
export function legacyRunAction(command: string): ResolvedSettingAction {
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
	preserved: PreservedEntry[],
): readonly ActionTarget[] | null | undefined {
	if (value === undefined) return undefined;
	const single = (input: unknown): ActionTarget | null => {
		if (input === "local" || input === "cloud") return input;
		dropped.push({ file, key, reason: "unsupported-value" });
		preserved.push({ path: key, value });
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
	preserved: PreservedEntry[],
): SettingAction | null {
	const path = `scripts.run.${id}`;
	if (!isRecord(raw)) {
		dropped.push({ file, key: path, reason: "wrong-type" });
		preserved.push({ path, value: raw });
		return null;
	}
	const command = raw["command"];
	if (typeof command !== "string") {
		dropped.push({ file, key: `${path}.command`, reason: "wrong-type" });
		preserved.push({ path, value: raw });
		return null;
	}
	const action: SettingAction = { id, command };
	const rawArgs = raw["args"];
	if (rawArgs !== undefined) {
		if (Array.isArray(rawArgs) && rawArgs.every((entry) => typeof entry === "string")) {
			action.args = [...rawArgs];
		} else {
			dropped.push({ file, key: `${path}.args`, reason: "wrong-type" });
			preserved.push({ path: `${path}.args`, value: rawArgs });
		}
	}
	const options = raw["options"];
	const rawCwd = isRecord(options) ? options["cwd"] : undefined;
	if (typeof rawCwd === "string") action.cwd = rawCwd;
	else if (rawCwd !== undefined) {
		dropped.push({ file, key: `${path}.options.cwd`, reason: "wrong-type" });
		preserved.push({ path: `${path}.options.cwd`, value: rawCwd });
	}
	const rawDefault = raw["default"];
	if (typeof rawDefault === "boolean") action.isDefault = rawDefault;
	else if (rawDefault !== undefined) {
		dropped.push({ file, key: `${path}.default`, reason: "wrong-type" });
		preserved.push({ path: `${path}.default`, value: rawDefault });
	}
	const rawHide = raw["hide"];
	if (typeof rawHide === "boolean") action.hidden = rawHide;
	else if (rawHide !== undefined) {
		dropped.push({ file, key: `${path}.hide`, reason: "wrong-type" });
		preserved.push({ path: `${path}.hide`, value: rawHide });
	}
	const rawIcon = raw["icon"];
	if (typeof rawIcon === "string") action.icon = rawIcon;
	else if (rawIcon !== undefined) {
		dropped.push({ file, key: `${path}.icon`, reason: "wrong-type" });
		preserved.push({ path: `${path}.icon`, value: rawIcon });
	}
	const availableIn = parseActionTargets(
		raw["available_in"],
		file,
		`${path}.available_in`,
		dropped,
		preserved,
	);
	if (availableIn === null) {
		preserved.push({ path, value: raw });
		return null;
	}
	if (availableIn !== undefined) action.availableIn = availableIn;
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
			dropped.push({ file, key: `${path}.${key}`, reason: "unknown-key" });
			preserved.push({ path: `${path}.${key}`, value: raw[key] });
		}
	}
	return action;
}

/** Copies only the fields a later layer actually set, so an unset field keeps its earlier value. */
function patchAction(previous: SettingAction, action: SettingAction): SettingAction {
	const merged: SettingAction = { ...previous };
	if (action.command !== undefined) merged.command = action.command;
	if (action.args !== undefined) merged.args = action.args;
	if (action.cwd !== undefined) merged.cwd = action.cwd;
	if (action.isDefault !== undefined) merged.isDefault = action.isDefault;
	if (action.hidden !== undefined) merged.hidden = action.hidden;
	if (action.icon !== undefined) merged.icon = action.icon;
	if (action.availableIn !== undefined) merged.availableIn = action.availableIn;
	return merged;
}

/**
 * Merges action layers per id. Later layers win field-by-field; an action keeps the position it
 * first appeared at. Comparison is case-insensitive. The result has the research defaults filled.
 */
export function mergeSettingActions(
	layers: readonly (readonly SettingAction[] | undefined)[],
): ResolvedSettingAction[] {
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
			byId.set(existingKey, patchAction(previous, action));
		}
	}
	return [...byId.values()].map(resolveSettingAction);
}

/** Parses `scripts.run` (a string or a table) and the legacy top-level `tasks` table. */
function parseActionSection(
	raw: unknown,
	file: string,
	key: string,
	dropped: DroppedSetting[],
	preserved: PreservedEntry[],
): { actions: SettingAction[]; legacyRun: string | null } {
	if (raw === undefined) return { actions: [], legacyRun: null };
	if (typeof raw === "string") return { actions: [legacyRunAction(raw)], legacyRun: raw };
	if (!isRecord(raw)) {
		dropped.push({ file, key, reason: "wrong-type" });
		preserved.push({ path: key, value: raw });
		return { actions: [], legacyRun: null };
	}
	const actions: SettingAction[] = [];
	for (const [id, value] of Object.entries(raw)) {
		const action = parseAction(id, value, file, dropped, preserved);
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
	preserved: PreservedEntry[],
	name: string,
): Record<string, FileEnvVar> {
	const result: Record<string, FileEnvVar> = {};
	if (raw === undefined) return result;
	if (!isRecord(raw)) {
		dropped.push({ file, key: name, reason: "wrong-type" });
		preserved.push({ path: name, value: raw });
		return result;
	}
	const take = (value: unknown, scope: EnvVarScope, prefix: string): void => {
		if (!isRecord(value)) {
			dropped.push({ file, key: prefix, reason: "wrong-type" });
			preserved.push({ path: prefix, value });
			return;
		}
		for (const [name, entry] of Object.entries(value)) {
			if (!ENV_VAR_NAME.test(name)) {
				dropped.push({ file, key: `${prefix}.${name}`, reason: "unsupported-value" });
				preserved.push({ path: `${prefix}.${name}`, value: entry });
				continue;
			}
			if (typeof entry !== "string") {
				dropped.push({ file, key: `${prefix}.${name}`, reason: "wrong-type" });
				preserved.push({ path: `${prefix}.${name}`, value: entry });
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
			take(entry, key, `${name}.${key}`);
		} else {
			topLevel[key] = entry;
		}
	}
	take(topLevel, "all", name);
	return result;
}

// ---------------------------------------------------------------- file shapes

export type DroppedReason =
	| "unreadable-file"
	| "invalid-file"
	| "unknown-key"
	| "wrong-type"
	| "unsupported-value";

export interface DroppedSetting {
	file: string;
	key: string;
	reason: DroppedReason;
}

/** A raw entry of a settings file that this service does not understand, kept for the next write. */
export interface PreservedEntry {
	path: string;
	value: unknown;
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
	/** Entries the reader could not use. The writer puts them back so a save never destroys them. */
	preserved: PreservedEntry[];
}

const TOML_KEY_TO_SETTING: Readonly<Record<string, string>> = tomlKeys();

const emptyContents = (file: string): SettingsFileContents => ({
	file,
	values: {},
	actions: {},
	envVars: {},
	dropped: [],
	preserved: [],
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
	const fromRun = parseActionSection(
		run,
		file,
		"scripts.run",
		contents.dropped,
		contents.preserved,
	);
	const fromTasks = parseActionSection(
		document["tasks"],
		file,
		"tasks",
		contents.dropped,
		contents.preserved,
	);
	const legacyRun = fromRun.legacyRun ?? fromTasks.legacyRun;
	for (const action of [...fromRun.actions, ...fromTasks.actions]) {
		contents.actions[action.id] = action;
	}

	const envName =
		document["environment_variables"] !== undefined
			? "environment_variables"
			: "environmentVariables";
	const envRaw = document[envName];
	contents.envVars = parseEnvVars(envRaw, file, contents.dropped, contents.preserved, envName);

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
			contents.preserved.push({ path, value: leaf.value });
			continue;
		}
		const def = getSettingDef(key);
		if (def === undefined) {
			contents.dropped.push({ file, key: path, reason: "unknown-key" });
			contents.preserved.push({ path, value: leaf.value });
			continue;
		}
		const coerced = coerceSettingValue(def, leaf.value);
		if (!coerced.ok) {
			contents.dropped.push({
				file,
				key: path,
				reason: dropReasonFromError(coerced.error.message),
			});
			contents.preserved.push({ path, value: leaf.value });
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

/** Drops the raw entries that a write of `tomlKey` replaces, so an old invalid value cannot win. */
function withoutPreserved(
	preserved: readonly PreservedEntry[],
	tomlKey: string | undefined,
): PreservedEntry[] {
	if (tomlKey === undefined) return [...preserved];
	return preserved.filter(
		(entry) => entry.path !== tomlKey && !entry.path.startsWith(`${tomlKey}.`),
	);
}

/** Builds the document a settings file gets on write: a schema line, known entries and raw ones. */
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
			if (action.args !== undefined && action.args.length > 0) table["args"] = [...action.args];
			if (action.cwd !== undefined && action.cwd !== null) table["options"] = { cwd: action.cwd };
			if (action.isDefault === true) table["default"] = true;
			if (action.icon !== undefined && action.icon !== null) table["icon"] = action.icon;
			if (action.hidden === true) table["hide"] = true;
			if (action.availableIn !== undefined) table["available_in"] = [...action.availableIn];
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
	for (const entry of contents.preserved) {
		if (entry.path === "$schema") continue;
		setTomlPath(document, entry.path, entry.value);
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
	window?: Pick<Platform["window"], "onFocusChanged">;
};

export interface SettingsServiceDeps {
	platform: SettingsPlatform;
	repos: Pick<Repositories, "settings" | "envVars">;
	toml: TomlCodec;
	/** The GIT-01 runner. The remote default-branch layer reads through it. */
	git?: Pick<GitRunner, "stdout">;
	/** Serial queue shared with the rest of the app. One queue per service when none is passed. */
	queue?: KeyedQueue<string>;
}

/** One row of `list`: the key, its effective value and the layer that supplied it. */
export interface ListedSetting {
	key: string;
	value: SettingValue;
	source: SettingLayer | "default";
}

interface PendingWrite {
	value: SettingValue;
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
	readonly #writes: KeyedQueue<string>;
	/** Writes that are visible in the store but not yet on disk, by setting key. */
	readonly #pending = new Map<string, PendingWrite>();
	#unsubscribeFocus: (() => void) | null = null;
	#reloadTimer: ReturnType<typeof setInterval> | null = null;

	constructor(deps: SettingsServiceDeps) {
		this.#deps = deps;
		this.#writes = deps.queue ?? createKeyedQueue<string>();
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
			dropped.push({
				file: userFile,
				key: userFile,
				reason: file.error.code === "settings_file_invalid" ? "invalid-file" : "unreadable-file",
			});
			warnings.push({ code: "settings_load_failed", message: SETTINGS_LOAD_FAILED_MESSAGE });
		}

		// A write that has not reached disk yet still wins over the older file text.
		for (const [key, pending] of this.#pending) values[key] = pending.value;

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
		const dropped: DroppedSetting[] = [];
		const fromTable = this.store.getState().values[key];
		if (fromTable !== undefined && fromTable !== null) {
			layers.push({ layer: "table", value: fromTable });
		}
		if (def.tomlKey !== undefined) {
			const userLayer = await this.#layerValue(this.#userFile(), def);
			dropped.push(...userLayer.dropped);
			if (userLayer.value !== null) layers.push({ layer: "user-file", value: userLayer.value });

			if (def.scopes.includes("repo") && def.fileLayers === "user-and-repo") {
				const remote = await this.#remoteLayer(repoRootPath, def);
				dropped.push(...remote.dropped);
				if (remote.value !== null) layers.push({ layer: "repo-remote", value: remote.value });

				const shared = await this.#layerValue(sharedSettingsFile(repoRootPath), def);
				dropped.push(...shared.dropped);
				if (shared.value !== null) layers.push({ layer: "repo-shared", value: shared.value });

				if (workspacePath !== null) {
					const workspace = await this.#layerValue(sharedSettingsFile(workspacePath), def);
					dropped.push(...workspace.dropped);
					if (workspace.value !== null) {
						layers.push({ layer: "workspace-shared", value: workspace.value });
					}
				}

				const local = await this.#layerValue(localSettingsFile(repoRootPath), def);
				dropped.push(...local.dropped);
				if (local.value !== null) layers.push({ layer: "repo-local", value: local.value });
			}
		}
		const resolved = resolveSetting(def, layers);
		return ok(dropped.length === 0 ? resolved : { ...resolved, dropped });
	}

	/** Every registry setting with its effective user-level value and the layer that supplied it. */
	list(): ListedSetting[] {
		const values = this.store.getState().values;
		return SETTINGS.map((def) => {
			const stored = values[def.key];
			if (stored !== undefined && stored !== null) {
				return {
					key: def.key,
					value: stored,
					source: def.tomlKey === undefined ? "table" : "user-file",
				};
			}
			return {
				key: def.key,
				value: def.type === "string-list" ? [...def.default] : def.default,
				source: "default",
			};
		});
	}

	/** Removes a setting: a table row is deleted, a file-backed key is removed from the user file. */
	async delete(key: string): Promise<Result<void>> {
		const def = getSettingDef(key);
		if (def === undefined) return err(appError("setting_unknown", `Unknown setting "${key}".`));
		if (def.tomlKey !== undefined) {
			return this.#setInFile(this.#userFile(), "user", def, null, false, key);
		}
		return this.#deleteInTable(def);
	}

	/**
	 * Resets one repository's personal value, so the repo shared file (or a higher layer) supplies
	 * it again. The button in the UI is "Reset to your repo's settings.toml".
	 */
	async resetForRepo(repoRootPath: string, key: string): Promise<Result<void>> {
		return this.setForRepo(repoRootPath, key, null);
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

	async #layerValue(
		file: string,
		def: SettingDef,
	): Promise<{ value: SettingValue | null; dropped: DroppedSetting[] }> {
		const result = await this.readSettingsFile(file);
		if (!result.ok) {
			const reason =
				result.error.code === "settings_file_invalid" ? "invalid-file" : "unreadable-file";
			return { value: null, dropped: [{ file, key: file, reason }] };
		}
		if (def.tomlKey === undefined) return { value: null, dropped: result.value.dropped };
		const value = result.value.values[def.key];
		return { value: value === undefined ? null : value, dropped: result.value.dropped };
	}

	async #remoteLayer(
		repoRootPath: string,
		def: SettingDef,
	): Promise<{ value: SettingValue | null; dropped: DroppedSetting[] }> {
		const git = this.#deps.git;
		if (git === undefined || def.tomlKey === undefined) return { value: null, dropped: [] };
		const head = await git.stdout(symbolicRefRemoteHead("origin"), { cwd: repoRootPath });
		if (!head.ok) return { value: null, dropped: [] };
		const branch = head.value.replace(/^refs\/remotes\//, "");
		if (branch === "") return { value: null, dropped: [] };
		const file = `${branch}:.conducted/settings.toml`;
		const shown = await git.stdout(showSettingsFileAt(branch), { cwd: repoRootPath });
		if (!shown.ok) return { value: null, dropped: [] };
		const parsed = this.#deps.toml.parse(shown.value);
		if (!parsed.ok) {
			return { value: null, dropped: [{ file, key: file, reason: "invalid-file" }] };
		}
		const contents = parseSettingsDocument(parsed.value, file);
		const value = contents.values[def.key];
		return { value: value === undefined ? null : value, dropped: contents.dropped };
	}

	async #setInTable(def: SettingDef, value: SettingValue): Promise<Result<void>> {
		const previous = this.store.getState().values[def.key];
		const pending = this.#beginWrite(def.key, value);
		const written = await this.#deps.repos.settings.set(def.key, value);
		if (!written.ok) {
			this.#rollback(def.key, pending, previous);
			return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
		}
		this.#finishWrite(def.key, pending);
		this.#logSaved(def.key, value);
		return ok(undefined);
	}

	async #deleteInTable(def: SettingDef): Promise<Result<void>> {
		const previous = this.store.getState().values[def.key];
		const pending = this.#beginWrite(def.key, null);
		const written = await this.#deps.repos.settings.delete(def.key);
		if (!written.ok) {
			this.#rollback(def.key, pending, previous);
			return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
		}
		this.#finishWrite(def.key, pending);
		this.#logSaved(def.key, null);
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
		const pending = this.#beginWrite(key, value);
		return this.#writes.run(file, async () => {
			const existing = await this.readSettingsFile(file);
			let contents: SettingsFileContents;
			if (existing.ok) {
				contents = existing.value;
			} else if (overwrite) {
				contents = emptyContents(file);
			} else {
				this.#rollback(key, pending, previous);
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
			contents.preserved = withoutPreserved(contents.preserved, def.tomlKey);
			const document = buildSettingsDocument(contents, scope);
			const text = this.#deps.toml.stringify(document);
			const written = await this.#deps.platform.fs.writeTextAtomic(file, text);
			if (!written.ok) {
				this.#rollback(key, pending, previous);
				return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
			}
			this.#finishWrite(key, pending);
			this.#logSaved(key, value);
			return ok(undefined);
		});
	}

	#beginWrite(key: string, value: SettingValue): PendingWrite {
		const pending = { value };
		this.#pending.set(key, pending);
		this.#setValue(key, value);
		return pending;
	}

	/** Clears a pending marker only when no newer write has replaced it. */
	#finishWrite(key: string, pending: PendingWrite): void {
		if (this.#pending.get(key) === pending) this.#pending.delete(key);
	}

	/**
	 * Puts the earlier value back only when this call still owns the store's value. If a later call
	 * already showed its own value, that value stays and the later write decides the outcome.
	 */
	#rollback(key: string, pending: PendingWrite, previous: SettingValue | undefined): void {
		if (this.#pending.get(key) !== pending) return;
		this.#pending.delete(key);
		const values = { ...this.store.getState().values };
		if (previous === undefined) delete values[key];
		else values[key] = previous;
		this.store.setState({ values });
	}

	#setValue(key: string, value: SettingValue): void {
		this.store.setState({ values: { ...this.store.getState().values, [key]: value } });
	}

	#logSaved(key: string, value: SettingValue): void {
		this.#deps.platform.app.writeLog("info", "Settings value saved", {
			key,
			value: redactSettingForLog(key, value),
		});
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
