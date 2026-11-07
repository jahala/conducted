/**
 * @feature DATA-05 Settings store and settings files
 * @feature SET-14 Keep comments when the app rewrites a settings file
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * @feature SET-04 Environment variables, stored in the Keychain
 * Owns: reading and writing settings from their layers (registry default, the `settings` table,
 * `~/.conducted/settings.toml`, `.conducted/settings.toml`, `.conducted/settings.local.toml`),
 * deciding the effective value, parsing the environment variable tables of a settings file
 * (names and markers), and parsing settings text that came from a git ref in a cloud repo's shared
 * clone (CLOUD-04), and opening the user's settings file or a project's local file in another
 * app (SET-02's "Open settings.toml"; a missing file is created empty first). The Keychain values
 * behind those names belong to SET-04.
 * Behaviour: services-map.md 4.2.1 (layers and precedence), 4.2.2 (scopes), 4.2.4 (settings.toml
 * schema, named actions, env var sections), ui-map.md 6, 5A.1.6 (named actions and their ids),
 * 2.5.2 (config reload on focus and every 30 s).
 * Must handle: precedence from lowest to highest is default, table, user file, remote default
 * branch, repo shared file, workspace shared file, repo local file; a key whose registry entry has
 * no repo scope ignores repo layers; an invalid TOML file never overwrites silently (the write
 * returns an Err with code `settings_file_invalid` and the UI offers "overwrite"); unknown keys,
 * wrong types and unsupported values are dropped and reported, never thrown; a later write does
 * not undo an earlier one that failed; writes keep unknown entries and a `$schema` line, and a new
 * file has sorted keys; a settings write shows in the store at once (optimistic) and rolls back if
 * the file write fails; two writes to one file run one after the other; values of sensitive
 * settings are redacted before they reach a log.
 * SET-14 must handle: a rewrite of an existing file changes only the entries whose values differ,
 * keeping comments, blank lines and key order; a comment beside or directly above an entry the
 * save removes goes with it; any other comment a save would drop (a legacy `[tasks]` table moved
 * to `scripts.run`, a file the patch cannot edit) is quoted in a warning that refuses the first
 * such save, and the next save that would drop the same comments goes ahead. Both settings file
 * writers, this service and PRJ-04's repository config, write through `updateSettingsFile`.
 * SET-04 must handle: removing a project removes its own variables and their Keychain entries as
 * one step; a Keychain entry that cannot be removed is an error the user sees, and its row stays
 * so a retry can remove it. A launch reads the env files every settings layer names (the user's,
 * the repository's shared and local files, and a workspace's shared file), resolving each path and
 * parsing it as dotenv; a repository's file wins over a saved variable of the same name and the
 * user's file does not (services-map.md 4.2.8); a missing or unreadable file is skipped with a log
 * line that names only its path, never its values.
 * Our design choice: file-backed keys (the ones with a `tomlKey` in the registry) live only in
 * TOML files; every other key lives in the `settings` table. There is no legacy `conductor.json`
 * migration. The TOML parser is passed in (`TomlCodec`) so tests and the app can differ. Per-user
 * hidden action ids belong to SET-07's file store, not to a settings file.
 * Test first: a repo shared value beats the user file for a repo-scoped key, and is ignored for a
 * user-only key.
 * SET-14 test first: saving one setting into a hand-written file changes only that value's text.
 * CLOUD-04 test first: a cloud repo reads the shared settings from the clone's branch.
 */
import {
	type AppError,
	appError,
	createKeyedQueue,
	err,
	type KeyedQueue,
	ok,
	type RepoId,
	type Result,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { Loadable } from "../api.ts";
import {
	conductedDir,
	localSettingsFile,
	sharedSettingsFile,
	userSettingsFile,
} from "../app-paths.ts";
import { fireAndForget } from "../async/fire-and-forget.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import type { EnvVar } from "../db/env-vars.ts";
import type { RepoRepository } from "../db/repos.ts";
import type { Repositories } from "../db/repositories.ts";
import { showSettingsFileAt, symbolicRefRemoteHead } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import type { ActionTarget, EnvScope, EnvVarView } from "../model.ts";
import {
	coerceSettingValue,
	getSettingDef,
	SETTINGS,
	type SettingDef,
	type SettingValue,
	tomlKeys,
} from "../registries/settings.ts";
import { parseDotenv, resolveEnvFilePath } from "./dotenv.ts";

export interface TomlCodec {
	parse(text: string): Result<Record<string, unknown>>;
	stringify(value: Record<string, unknown>): Result<string>;
	/** Edits `text` so it holds `value`, changing only entries whose values differ (SET-14). */
	patch(text: string, value: Record<string, unknown>): Result<string>;
	/** Every comment of `text` in order, from its `#` to the end of its line. */
	comments(text: string): string[];
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

/** The most comments a warning quotes before it counts the rest. */
const QUOTED_COMMENTS = 3;

/**
 * The warning a save gets when it would drop comments (SET-14). Our own text: Conductor drops
 * comments without a word, so the research has none.
 */
function commentsDroppedMessage(file: string, comments: readonly string[]): string {
	const what = comments.length === 1 ? "a comment" : `${comments.length} comments`;
	const quoted = comments.slice(0, QUOTED_COMMENTS).map((comment) => JSON.stringify(comment));
	const rest = comments.length - quoted.length;
	const list = rest > 0 ? `${quoted.join(", ")} and ${rest} more` : quoted.join(", ");
	return `Saving would remove ${what} from ${file}: ${list}. Save again to go ahead.`;
}

/** The comments of `before` that `after` no longer has, counting repeats. */
function droppedComments(before: readonly string[], after: readonly string[]): string[] {
	const left = new Map<string, number>();
	for (const comment of after) left.set(comment, (left.get(comment) ?? 0) + 1);
	const dropped: string[] = [];
	for (const comment of before) {
		const count = left.get(comment) ?? 0;
		if (count > 0) left.set(comment, count - 1);
		else dropped.push(comment);
	}
	return dropped;
}

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

/** Path parts that would reach the object prototype instead of a table of the document. */
const UNSAFE_PATH_PARTS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Writes a dotted key such as `models.default` into a parsed document. A path with a part that
 * names the prototype is refused (returns false), so a settings file cannot change shared objects.
 */
export function setTomlPath(root: Record<string, unknown>, path: string, value: unknown): boolean {
	const parts = path.split(".");
	if (parts.some((part) => UNSAFE_PATH_PARTS.has(part))) return false;
	let current = root;
	for (let index = 0; index < parts.length - 1; index += 1) {
		const part = parts[index];
		if (part === undefined) return false;
		const next = Object.hasOwn(current, part) ? current[part] : undefined;
		if (isRecord(next)) {
			current = next;
		} else {
			const created: Record<string, unknown> = {};
			current[part] = created;
			current = created;
		}
	}
	const last = parts.at(-1);
	if (last === undefined) return false;
	current[last] = value;
	return true;
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

export type { ActionTarget };

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

/** A stable key for one environment variable scope, for the store and for the hook. */
export const envScopeKey = (scope: EnvScope): string =>
	scope === "global" ? "global" : `repo:${scope.repoId}`;

/**
 * Names the app fills in itself. They are refused in the form so a saved variable never fights the
 * app's own value (services-map.md 4.2.8 and 5A.1.2).
 */
export const RESERVED_ENV_VAR_NAMES: readonly string[] = [
	"CONDUCTED_WORKSPACE_ID",
	"CONDUCTED_WORKSPACE_NAME",
	"CONDUCTED_WORKSPACE_PATH",
	"CONDUCTED_ROOT_PATH",
	"CONDUCTED_DEFAULT_BRANCH",
	"CONDUCTED_PORT",
	"CONDUCTED_PATH_PREFIX",
];

export const isReservedEnvVarName = (name: string): boolean =>
	name.startsWith("CONDUCTED_") || RESERVED_ENV_VAR_NAMES.includes(name);

export const ENV_SAVE_FAILED_MESSAGE = "Couldn't update your environment variables";
export const ENV_FILES_FAILED_MESSAGE = "Failed to update env files";

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
	/** Variables of each scope that has been read, keyed by `envScopeKey`. */
	envVars?: Readonly<Record<string, Loadable<EnvVarView[]>>>;
}

export type SettingsPlatform = Pick<Platform, "fs" | "keychain" | "app"> & {
	window?: Pick<Platform["window"], "onFocusChanged">;
	/** Opens a settings file in the app the user picks ("Open settings.toml"). */
	opener: Pick<Platform["opener"], "openWith">;
};

/** A settings file the user can open: their own, or one project's local file. */
export type SettingsFileRef = "user" | { repoId: RepoId };

export interface SettingsServiceDeps {
	platform: SettingsPlatform;
	repos: Pick<Repositories, "settings" | "envVars"> & {
		/**
		 * The repository list, so a global variable can say how many repositories override it, and
		 * a repository's folder, for a reset of one of its values.
		 */
		repos?: Pick<RepoRepository, "list" | "get">;
	};
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
	/** The last value known to be saved. A failed write puts this back, not an unsaved value. */
	previous: SettingValue | undefined;
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
	/** Only the newest reload may change the store. */
	readonly #reloads = createLatestWins<"reload">();
	/** Only the newest environment-variable read of one scope may change the store. */
	readonly #envReads = createLatestWins<string>();
	/** Counts store changes made by writes. A reload keeps what a write changed after it began. */
	#epoch = 0;
	readonly #touchedAt = new Map<string, number>();
	#unsubscribeFocus: (() => void) | null = null;
	#reloadTimer: ReturnType<typeof setInterval> | null = null;
	/** Set by `stop`. A start still reading when the stop came installs no listener or timer. */
	#stopped = false;
	/**
	 * The comments each file's last refused save would have dropped (SET-14). The next save that
	 * would drop exactly these goes ahead: the user has been warned.
	 */
	readonly #commentWarnings = new Map<string, string>();

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
		const ticket = this.#reloads.begin("reload");
		const startEpoch = this.#epoch;
		const dropped: DroppedSetting[] = [];
		const warnings: SettingsWarning[] = [];
		const fromTable: Record<string, SettingValue> = {};
		const fromFile: Record<string, SettingValue> = {};

		const rows = await this.#deps.repos.settings.list();
		if (!rows.ok) {
			warnings.push({ code: "settings_load_failed", message: SETTINGS_LOAD_FAILED_MESSAGE });
		} else {
			for (const row of rows.value) {
				const def = getSettingDef(row.key);
				if (def === undefined || def.tomlKey !== undefined) continue;
				const coerced = coerceSettingValue(def, row.value);
				if (coerced.ok) fromTable[def.key] = coerced.value;
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
				if (def?.tomlKey !== undefined) fromFile[key] = value;
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

		// A newer reload started while this one read: its answer is the one that counts.
		if (!this.#reloads.isLatest(ticket)) return ok(undefined);
		this.#reloads.settle(ticket);

		const current = this.store.getState().values;
		// A part that could not be read keeps the values it had, so one bad read does not reset them.
		const values: Record<string, SettingValue> = {};
		for (const [key, value] of Object.entries(current)) {
			const isFileKey = getSettingDef(key)?.tomlKey !== undefined;
			if (isFileKey ? !file.ok : !rows.ok) values[key] = value;
		}
		Object.assign(values, fromTable, fromFile);

		// A write that changed a key after this reload began is newer than what was read.
		for (const [key, at] of this.#touchedAt) {
			if (at <= startEpoch) continue;
			const now = current[key];
			if (now === undefined) delete values[key];
			else values[key] = now;
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
	 * Backs `Actions.settings.resetForRepo`. Resets one repository's personal value, so the repo
	 * shared file (or a higher layer) supplies it again.
	 */
	async resetForRepo(repoId: RepoId, key: string): Promise<Result<void>> {
		const repositories = this.#deps.repos.repos;
		if (repositories === undefined) {
			return err(appError("repo_unknown", "The project list is not available."));
		}
		const found = await repositories.get(repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		return this.setForRepo(found.value.rootPath, key, null);
	}

	/** Backs `Actions.settings.filePath`: the user's settings file, or a project's local one. */
	async filePath(file: SettingsFileRef): Promise<Result<string>> {
		if (file === "user") return ok(this.#userFile());
		const repositories = this.#deps.repos.repos;
		if (repositories === undefined) {
			return err(appError("repo_unknown", "The project list is not available."));
		}
		const found = await repositories.get(file.repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		return ok(localSettingsFile(found.value.rootPath));
	}

	/**
	 * Backs `Actions.settings.openFile`, Conductor's "Open settings.toml": creates the file empty
	 * when it is missing, then opens it in the named app. A file that exists is left as it is.
	 */
	async openFile(file: SettingsFileRef, appName: string): Promise<Result<void>> {
		const path = await this.filePath(file);
		if (!path.ok) return path;
		const fs = this.#deps.platform.fs;
		const made = await this.#writes.run(path.value, async (): Promise<Result<void>> => {
			if (await fs.exists(path.value)) return ok(undefined);
			const folder = await fs.mkdirp(path.value.slice(0, path.value.lastIndexOf("/")));
			if (!folder.ok) return folder;
			return fs.writeTextAtomic(path.value, "");
		});
		if (!made.ok) {
			// Conductor's title for this failure is "Failed to prepare file to open".
			return err(appError("open_in_prepare_failed", `Couldn't create ${path.value}.`, made.error));
		}
		return this.#deps.platform.opener.openWith(appName, path.value);
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
		const read = await this.#readFile(path);
		return read.ok ? ok(read.value.contents) : read;
	}

	/**
	 * Reads settings text that came from somewhere other than a file on disk, such as a git ref in
	 * a cloud repo's shared clone (CLOUD-04). `file` is the source path shown with the values.
	 */
	readSettingsText(text: string, file: string): Result<SettingsFileContents> {
		const parsed = this.#deps.toml.parse(text);
		if (!parsed.ok) {
			return err(appError("settings_file_invalid", SETTINGS_FILE_INVALID_MESSAGE, parsed.error));
		}
		return ok(parseSettingsDocument(parsed.value, file));
	}

	/**
	 * Reads a settings file, lets `edit` change its contents and writes it back, after any other
	 * write to the same file. Comments are kept as `#rewrite` describes. Backs every settings file
	 * write outside this service, such as a repository's config (PRJ-04).
	 */
	updateSettingsFile(
		file: string,
		scope: "user" | "repo",
		edit: (contents: SettingsFileContents) => void,
		options: SetOptions = {},
	): Promise<Result<void>> {
		return this.#writes.run(file, () =>
			this.#rewrite(file, scope, edit, options.overwrite === true),
		);
	}

	/** The file's text and what it holds. The text is null when there is no file. */
	async #readFile(
		path: string,
	): Promise<Result<{ text: string | null; contents: SettingsFileContents }>> {
		if (!(await this.#deps.platform.fs.exists(path))) {
			return ok({ text: null, contents: emptyContents(path) });
		}
		const text = await this.#deps.platform.fs.readText(path);
		if (!text.ok) {
			return err(appError("settings_file_unreadable", `Could not read ${path}.`, text.error));
		}
		const parsed = this.#deps.toml.parse(text.value);
		if (!parsed.ok) {
			return err(appError("settings_file_invalid", SETTINGS_FILE_INVALID_MESSAGE, parsed.error));
		}
		return ok({ text: text.value, contents: parseSettingsDocument(parsed.value, path) });
	}

	/**
	 * Applies `edit` to a settings file and writes it (SET-14). A new file is written whole. An
	 * existing file's own text is patched in two steps, so its comments, blank lines and key order
	 * stay. The first step brings the file to the shape the app writes: a `$schema` line, a legacy
	 * `[tasks]` table or a plain `scripts.run` string moved to `scripts.run` tables. The second step
	 * applies the edit, and a comment it drops belonged to an entry the edit removed. A comment the
	 * first step drops is lost without the user's doing, and so is every comment when the text
	 * cannot be patched at all: the first save that would drop such comments is refused with a
	 * warning that quotes them, and the next save that would drop the same ones goes ahead.
	 * Runs inside the caller's queue slot for the file.
	 */
	async #rewrite(
		file: string,
		scope: "user" | "repo",
		edit: (contents: SettingsFileContents) => void,
		overwrite: boolean,
	): Promise<Result<void>> {
		const read = await this.#readFile(file);
		let source: string | null = null;
		let contents: SettingsFileContents;
		if (read.ok) {
			source = read.value.text;
			contents = read.value.contents;
		} else if (overwrite) {
			contents = emptyContents(file);
		} else {
			return err(
				appError(
					"settings_file_invalid",
					read.error.code === "settings_file_invalid"
						? SETTINGS_FILE_INVALID_MESSAGE
						: `Could not read ${file}.`,
					read.error,
				),
			);
		}
		const toml = this.#deps.toml;
		let text: string;
		let lost: string[] = [];
		try {
			// The first step runs before `edit`, which changes `contents` in place.
			const shaped =
				source === null ? null : toml.patch(source, buildSettingsDocument(contents, scope));
			edit(contents);
			const next = buildSettingsDocument(contents, scope);
			const patched = shaped?.ok === true ? toml.patch(shaped.value, next) : null;
			if (source === null) {
				const written = toml.stringify(next);
				if (!written.ok) return err(written.error);
				text = written.value;
			} else if (shaped?.ok === true && patched?.ok === true) {
				text = patched.value;
				lost = droppedComments(toml.comments(source), toml.comments(shaped.value));
			} else {
				// The file cannot be edited in place, so it is written whole.
				const written = toml.stringify(next);
				if (!written.ok) return err(written.error);
				text = written.value;
				lost = droppedComments(toml.comments(source), toml.comments(text));
			}
		} catch (cause) {
			return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, cause));
		}
		if (lost.length > 0) {
			const signature = lost.join("\n");
			if (this.#commentWarnings.get(file) !== signature) {
				this.#commentWarnings.set(file, signature);
				return err(appError("settings_comments_dropped", commentsDroppedMessage(file, lost)));
			}
		}
		const written = await this.#deps.platform.fs.writeTextAtomic(file, text);
		if (!written.ok) {
			return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
		}
		this.#commentWarnings.delete(file);
		return ok(undefined);
	}

	/** Stops the reload timer and the window focus listener, also for a start still running. */
	stop(): void {
		this.#stopped = true;
		this.#unsubscribeFocus?.();
		this.#unsubscribeFocus = null;
		if (this.#reloadTimer !== null) {
			clearInterval(this.#reloadTimer);
			this.#reloadTimer = null;
		}
	}

	/** Backs `Actions.settings.setEnvVar`: value into the Keychain, name and scope into `env_vars`. */
	async setEnvVar(
		name: string,
		value: string,
		scope: "global" | { repoId: RepoId },
	): Promise<Result<void>> {
		const valid = validateEnvVarName(name);
		if (!valid.ok) return valid;
		if (isReservedEnvVarName(name)) {
			return err(
				appError("env_name_reserved", `The app sets ${name} itself. Choose another name.`),
			);
		}
		const keychainRef = envVarKeychainKey(scope, name);
		const saved = await this.#deps.platform.keychain.set(keychainRef, value);
		if (!saved.ok) {
			return err(appError("env_save_failed", ENV_SAVE_FAILED_MESSAGE, saved.error));
		}
		const row = await this.#deps.repos.envVars.set({
			name,
			scope: scope === "global" ? "global" : "repo",
			repoId: scope === "global" ? null : scope.repoId,
			keychainRef,
		});
		if (!row.ok) {
			const undone = await this.#deps.platform.keychain.delete(keychainRef);
			if (!undone.ok) {
				this.#deps.platform.app.writeLog("warn", `Could not undo the Keychain entry ${name}`, {
					cause: undone.error.message,
				});
			}
			return err(appError("env_save_failed", ENV_SAVE_FAILED_MESSAGE, row.error));
		}
		await this.loadEnvVars(scope);
		return ok(undefined);
	}

	/** Backs `Actions.settings.removeEnvVar`. The row and its Keychain entry go together. */
	async removeEnvVar(name: string, scope: "global" | { repoId: RepoId }): Promise<Result<void>> {
		const removed = await this.#removeEnvVars([
			{
				name,
				scope: scope === "global" ? "global" : "repo",
				repoId: scope === "global" ? null : scope.repoId,
				keychainRef: envVarKeychainKey(scope, name),
			},
		]);
		if (!removed.ok) return removed;
		await this.loadEnvVars(scope);
		return ok(undefined);
	}

	/**
	 * Backs the removal of a project: deletes its own variables and their Keychain entries (SET-04).
	 * A global variable belongs to every project, so it stays.
	 */
	async removeEnvVarsForRepo(repoId: RepoId): Promise<Result<void>> {
		const listed = await this.#deps.repos.envVars.listByRepo(repoId);
		if (!listed.ok) {
			return err(appError("env_save_failed", ENV_SAVE_FAILED_MESSAGE, listed.error));
		}
		return this.#removeEnvVars(listed.value);
	}

	/**
	 * Removes each row's Keychain entry before its row. A Keychain failure leaves the row to retry
	 * and is an error the user sees, never a silent leftover.
	 */
	async #removeEnvVars(rows: readonly EnvVar[]): Promise<Result<void>> {
		for (const row of rows) {
			const deleted = await this.#deps.platform.keychain.delete(row.keychainRef);
			if (!deleted.ok) {
				return err(appError("env_save_failed", ENV_SAVE_FAILED_MESSAGE, deleted.error));
			}
			const removed = await this.#deps.repos.envVars.delete(row.name, row.scope, row.repoId);
			if (!removed.ok) {
				return err(appError("env_save_failed", ENV_SAVE_FAILED_MESSAGE, removed.error));
			}
		}
		return ok(undefined);
	}

	/** Reads one value for the reveal button. Null means no value is stored. */
	async revealEnvVar(
		name: string,
		scope: "global" | { repoId: RepoId },
	): Promise<Result<string | null>> {
		const read = await this.#deps.platform.keychain.get(envVarKeychainKey(scope, name));
		return read.ok ? ok(read.value) : err(appError("env_read_failed", read.error.message));
	}

	/**
	 * Reads the variables of one scope into the store. Only the newest read of a scope may change
	 * the store, so two overlapping reads never put the older answer back.
	 */
	async loadEnvVars(scope: "global" | { repoId: RepoId }): Promise<Result<void>> {
		const key = envScopeKey(scope);
		const previous = this.store.getState().envVars ?? {};
		if (previous[key] === undefined) {
			this.store.setState({ envVars: { ...previous, [key]: { state: "loading" } } });
		}
		const ticket = this.#envReads.begin(key);
		const views = await this.#envViews(scope);
		if (!this.#envReads.isLatest(ticket)) return ok(undefined);
		this.#envReads.settle(ticket);
		const latest = this.store.getState().envVars ?? {};
		this.store.setState({
			envVars: {
				...latest,
				[key]: views.ok
					? { state: "ready", data: views.value }
					: { state: "error", error: views.error },
			},
		});
		return views.ok ? ok(undefined) : err(views.error);
	}

	/**
	 * The Environment page's Keychain variables for one repository. Rows come in name order with the
	 * global row before the repository's (env-vars.ts), so a repository's value replaces the global
	 * one of the same name. Without a repository (an agent's model list), the global variables only.
	 * A value the Keychain cannot give back fails the whole read with a message that names the
	 * variable, never the global value instead. The env files named by the settings layers are read
	 * by `environmentForLaunch`, which wraps this method.
	 */
	async environmentFor(repoId: RepoId | null): Promise<Result<Record<string, string>>> {
		const listed =
			repoId === null
				? await this.#deps.repos.envVars.listGlobal()
				: await this.#deps.repos.envVars.listForRepo(repoId);
		if (!listed.ok) {
			return err(
				appError(
					"env_list_failed",
					`The environment variables could not be read: ${listed.error.message}`,
					listed.error,
				),
			);
		}
		const env: Record<string, string> = {};
		for (const entry of listed.value) {
			const read = await this.#deps.platform.keychain.get(entry.keychainRef);
			if (!read.ok) {
				return err(
					appError(
						"env_read_failed",
						`The value of ${entry.name} could not be read from the Keychain: ${read.error.message}`,
						read.error,
					),
				);
			}
			if (read.value === null) {
				return err(
					appError(
						"env_value_missing",
						`The value of ${entry.name} is missing from the Keychain. Enter it again in Settings.`,
					),
				);
			}
			env[entry.name] = read.value;
		}
		return ok(env);
	}

	/**
	 * The variables an agent's launch and a workspace's scripts start with: the env files named by
	 * every settings layer, then the Keychain rows (SET-04). Conductor's read merge (services-map.md
	 * 4.2.8): a variable a repository's settings file defines wins over a saved variable of the same
	 * name; the user's file does not, so a value the user saved on the Environment page wins there.
	 * Layers are read in Conductor's order, user, repository shared, workspace shared, repository
	 * local, and a later file replaces an earlier one. For a cloud workspace both folder arguments
	 * are its sandbox folder, so the platform's file calls reach the Worker; the user layer is the
	 * Mac's own settings. Without a repository (a model list) only the user layer applies.
	 */
	async environmentForLaunch(
		repoId: RepoId | null,
		repoRootPath: string | null,
		workspacePath: string | null,
	): Promise<Result<Record<string, string>>> {
		const files = await this.#envFileEnvironment(repoRootPath, workspacePath);
		if (!files.ok) return files;
		const stored = await this.environmentFor(repoId);
		if (!stored.ok) return stored;
		const env: Record<string, string> = { ...files.value.values };
		for (const [name, value] of Object.entries(stored.value)) {
			// A repository's file is more specific than a saved variable, so it keeps its value.
			if (files.value.repoNames.has(name)) continue;
			env[name] = value;
		}
		return ok(env);
	}

	/** The settings layers that can list env files, lowest precedence first. */
	#envFileLayers(
		repoRootPath: string | null,
		workspacePath: string | null,
	): {
		file: string;
		settingsDir: string;
		sourceRoot: string;
		scope: "user" | "repo";
	}[] {
		const paths = this.#deps.platform.fs.paths;
		const layers: {
			file: string;
			settingsDir: string;
			sourceRoot: string;
			scope: "user" | "repo";
		}[] = [
			{
				file: userSettingsFile(paths),
				settingsDir: conductedDir(paths.home),
				sourceRoot: paths.home,
				scope: "user",
			},
		];
		if (repoRootPath === null) return layers;
		layers.push({
			file: sharedSettingsFile(repoRootPath),
			settingsDir: conductedDir(repoRootPath),
			sourceRoot: repoRootPath,
			scope: "repo",
		});
		if (workspacePath !== null && workspacePath !== repoRootPath) {
			layers.push({
				file: sharedSettingsFile(workspacePath),
				settingsDir: conductedDir(workspacePath),
				sourceRoot: workspacePath,
				scope: "repo",
			});
		}
		layers.push({
			file: localSettingsFile(repoRootPath),
			settingsDir: conductedDir(repoRootPath),
			sourceRoot: repoRootPath,
			scope: "repo",
		});
		return layers;
	}

	/**
	 * The values of every env file the settings layers name, and the names that came from a
	 * repository layer. A file that is missing or unreadable is skipped with a log line that names
	 * its path, as Conductor does; a value never reaches a log line.
	 */
	async #envFileEnvironment(
		repoRootPath: string | null,
		workspacePath: string | null,
	): Promise<Result<{ values: Record<string, string>; repoNames: Set<string> }>> {
		const fs = this.#deps.platform.fs;
		const values: Record<string, string> = {};
		const repoNames = new Set<string>();
		for (const layer of this.#envFileLayers(repoRootPath, workspacePath)) {
			const contents = await this.readSettingsFile(layer.file);
			if (!contents.ok) {
				this.#deps.platform.app.writeLog(
					"warn",
					`Could not read ${layer.file} for its environment files.`,
					{ cause: contents.error.message },
				);
				continue;
			}
			const listed = contents.value.values["environment_variable_files"];
			if (!Array.isArray(listed)) continue;
			for (const path of listed) {
				if (typeof path !== "string" || path.trim() === "") continue;
				const resolved = await resolveEnvFilePath({
					path,
					settingsDir: layer.settingsDir,
					sourceRoot: layer.sourceRoot,
					home: fs.paths.home,
					exists: (candidate) => fs.exists(candidate),
				});
				const text = await fs.readText(resolved);
				if (!text.ok) {
					this.#deps.platform.app.writeLog(
						"warn",
						`Could not read the environment file ${resolved}.`,
						{ cause: text.error.message },
					);
					continue;
				}
				for (const pair of parseDotenv(text.value)) {
					values[pair.name] = pair.value;
					if (layer.scope === "repo") repoNames.add(pair.name);
				}
			}
		}
		return ok({ values, repoNames });
	}

	async #envViews(scope: "global" | { repoId: RepoId }): Promise<Result<EnvVarView[]>> {
		const global = await this.#deps.repos.envVars.listGlobal();
		if (!global.ok) return global;
		const ids = await this.#repoIds();
		if (!ids.ok) return ids;
		const overrides = new Map<string, number>();
		for (const repoId of ids.value) {
			const rows = await this.#deps.repos.envVars.listByRepo(repoId);
			if (!rows.ok) return rows;
			for (const row of rows.value) {
				overrides.set(row.name, (overrides.get(row.name) ?? 0) + 1);
			}
		}
		const globalNames = new Set(global.value.map((row) => row.name));
		const ownRows: EnvVar[] = [];
		if (scope !== "global") {
			const listed = await this.#deps.repos.envVars.listByRepo(scope.repoId);
			if (!listed.ok) return listed;
			ownRows.push(...listed.value);
		}
		const ownNames = new Set(ownRows.map((row) => row.name));
		const rows: { name: string; rowScope: EnvScope; keychainRef: string }[] = global.value
			.filter((row) => !ownNames.has(row.name))
			.map((row) => ({
				name: row.name,
				rowScope: "global",
				keychainRef: row.keychainRef,
			}));
		if (scope !== "global") {
			rows.push(
				...ownRows.map((row) => ({
					name: row.name,
					rowScope: scope,
					keychainRef: row.keychainRef,
				})),
			);
		}
		const views: EnvVarView[] = [];
		for (const row of rows) {
			const read = await this.#deps.platform.keychain.get(row.keychainRef);
			if (!read.ok) {
				return err(
					appError(
						"env_read_failed",
						`The value of ${row.name} could not be read from the Keychain: ${read.error.message}`,
						read.error,
					),
				);
			}
			views.push({
				name: row.name,
				scope: row.rowScope,
				hasValue: read.value !== null,
				overridesGlobal: row.rowScope !== "global" && globalNames.has(row.name),
				overriddenInRepos: row.rowScope === "global" ? (overrides.get(row.name) ?? 0) : 0,
			});
		}
		views.sort((left, right) => left.name.localeCompare(right.name));
		return ok(views);
	}

	async #repoIds(): Promise<Result<readonly RepoId[]>> {
		const repositories = this.#deps.repos.repos;
		if (repositories === undefined) return ok([]);
		const listed = await repositories.list({ includeHidden: true });
		return listed.ok ? ok(listed.value.map((repo) => repo.id)) : listed;
	}

	// -------------------------------------------------------------- internals

	#userFile(): string {
		return userSettingsFile(this.#deps.platform.fs.paths);
	}

	#startReloading(): void {
		if (this.#stopped) return;
		if (this.#unsubscribeFocus === null) {
			const window = this.#deps.platform.window;
			if (window !== undefined) {
				this.#unsubscribeFocus = window.onFocusChanged((focused) => {
					if (focused) this.#reloadInBackground();
				});
			}
		}
		if (this.#reloadTimer === null) {
			const timer = setInterval(() => this.#reloadInBackground(), RELOAD_INTERVAL_MS);
			(timer as unknown as { unref?: () => void }).unref?.();
			this.#reloadTimer = timer;
		}
	}

	/** A reload nobody waits for. A platform failure becomes a warning in the store. */
	#reloadInBackground(): void {
		fireAndForget(
			() => this.reloadFromDisk(),
			(cause) => {
				const warning = { code: "settings_load_failed", message: SETTINGS_LOAD_FAILED_MESSAGE };
				this.store.setState((state) => ({
					warnings: [...state.warnings.filter((w) => w.code !== warning.code), warning],
				}));
				this.#deps.platform.app.writeLog("warn", "Settings reload failed", {
					cause: String(cause),
				});
			},
		);
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

	#setInTable(def: SettingDef, value: SettingValue): Promise<Result<void>> {
		const pending = this.#beginWrite(def.key, value);
		return this.#writes.run(`table:${def.key}`, async () => {
			const written = await this.#deps.repos.settings.set(def.key, value);
			if (!written.ok) {
				this.#rollback(def.key, pending);
				return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
			}
			this.#finishWrite(def.key, pending);
			this.#logSaved(def.key, value);
			return ok(undefined);
		});
	}

	#deleteInTable(def: SettingDef): Promise<Result<void>> {
		const pending = this.#beginWrite(def.key, null);
		return this.#writes.run(`table:${def.key}`, async () => {
			const written = await this.#deps.repos.settings.delete(def.key);
			if (!written.ok) {
				this.#rollback(def.key, pending);
				return err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE, written.error));
			}
			this.#finishWrite(def.key, pending);
			this.#logSaved(def.key, null);
			return ok(undefined);
		});
	}

	/**
	 * Writes one key into a settings file. The user file also drives the store, so a user-scope
	 * write shows at once and rolls back on failure. A repo-scope write must not touch the store:
	 * it holds user-level values, and a value for one repository would show for all of them.
	 */
	#setInFile(
		file: string,
		scope: "user" | "repo",
		def: SettingDef,
		value: SettingValue,
		overwrite: boolean,
		key: string,
	): Promise<Result<void>> {
		const pending = scope === "user" ? this.#beginWrite(key, value) : null;
		const fail = (error: AppError): Result<void> => {
			if (pending !== null) this.#rollback(key, pending);
			return err(error);
		};
		return this.#writes.run(file, async () => {
			const written = await this.#rewrite(
				file,
				scope,
				(contents) => {
					if (value === null) {
						delete contents.values[key];
					} else {
						contents.values[key] = value;
					}
					contents.preserved = withoutPreserved(contents.preserved, def.tomlKey);
				},
				overwrite,
			);
			if (!written.ok) return fail(written.error);
			if (pending !== null) this.#finishWrite(key, pending);
			this.#logSaved(key, value);
			return ok(undefined);
		});
	}

	#beginWrite(key: string, value: SettingValue): PendingWrite {
		const earlier = this.#pending.get(key);
		const previous = earlier !== undefined ? earlier.previous : this.store.getState().values[key];
		const pending = { value, previous };
		this.#pending.set(key, pending);
		this.#setValue(key, value);
		return pending;
	}

	/**
	 * Clears a pending marker only when no newer write has replaced it. A newer write now has this
	 * value as the last one known to be saved.
	 */
	#finishWrite(key: string, pending: PendingWrite): void {
		const newest = this.#pending.get(key);
		if (newest === pending) this.#pending.delete(key);
		else if (newest !== undefined) newest.previous = pending.value;
		this.#touch(key);
	}

	/**
	 * Puts the last saved value back only when this call still owns the store's value. If a later
	 * call already showed its own value, that value stays and the later write decides the outcome.
	 */
	#rollback(key: string, pending: PendingWrite): void {
		if (this.#pending.get(key) !== pending) return;
		this.#pending.delete(key);
		const values = { ...this.store.getState().values };
		if (pending.previous === undefined) delete values[key];
		else values[key] = pending.previous;
		this.store.setState({ values });
		this.#touch(key);
	}

	#setValue(key: string, value: SettingValue): void {
		this.store.setState({ values: { ...this.store.getState().values, [key]: value } });
		this.#touch(key);
	}

	#touch(key: string): void {
		this.#epoch += 1;
		this.#touchedAt.set(key, this.#epoch);
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
