/**
 * @feature DATA-01 Repository for the settings table
 * Owns: the key/value rows behind the settings registry. Repo-scoped values use the key
 * "repo:<repoId>:<key>".
 * Behaviour: services-map.md 2.3.5 (settings: get, list, set, delete) and Part 6 step 6 (all rows
 * are loaded once at startup). Our table has no deprecated_at column.
 * Must handle: set is an upsert, so the first write and later writes use one statement; a bad
 * JSON value returns an error Result; a value JSON cannot hold (undefined) is refused instead of
 * stored as NULL; deleting a repo must delete its "repo:<id>:" rows (no foreign key covers them).
 * Test first: settingToParams on undefined returns an error Result.
 */
import { notImplemented, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import { parseJsonText, stringifyJson } from "./row-codec.ts";

export interface SettingRow {
	key: string;
	value: string;
	updated_at: number;
}

export interface Setting {
	key: string;
	/** Parsed JSON. The settings registry checks the shape for each key. */
	value: unknown;
	updatedAt: number;
}

export function settingFromRow(row: SettingRow): Result<Setting> {
	const value = parseJsonText(row.value, `settings.value for ${row.key}`);
	if (!value.ok) return value;
	return { ok: true, value: { key: row.key, value: value.value, updatedAt: row.updated_at } };
}

/** Parameters for SETTINGS_SQL.upsert, in column order. */
export function settingToParams(setting: Setting): Result<readonly unknown[]> {
	const value = stringifyJson(setting.value, `settings.value for ${setting.key}`);
	if (!value.ok) return value;
	return { ok: true, value: [setting.key, value.value, setting.updatedAt] };
}

/** The key for a repo-scoped setting. One home for the format. */
export const repoSettingKey = (repoId: string, key: string): string => `repo:${repoId}:${key}`;

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const SETTINGS_SQL = {
	get: "SELECT key, value, updated_at FROM settings WHERE key = $1",
	list: "SELECT key, value, updated_at FROM settings ORDER BY key",
	/** `$1` is a prefix such as "repo:<id>:". Compared by length, so no LIKE escaping is needed. */
	listByPrefix: `SELECT key, value, updated_at FROM settings
		WHERE substr(key, 1, length($1)) = $1 ORDER BY key`,
	upsert: `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
	delete: "DELETE FROM settings WHERE key = $1",
	deleteByPrefix: "DELETE FROM settings WHERE substr(key, 1, length($1)) = $1",
} as const;

export interface SettingsRepository {
	/** SETTINGS_SQL.get. A missing key is `ok(null)`. */
	get(key: string): Promise<Result<Setting | null>>;
	/** SETTINGS_SQL.list, for the single load at startup. */
	list(): Promise<Result<Setting[]>>;
	/** SETTINGS_SQL.listByPrefix, for all values of one repo. */
	listByPrefix(prefix: string): Promise<Result<Setting[]>>;
	/** SETTINGS_SQL.upsert with updated_at from the clock. */
	set(key: string, value: unknown): Promise<Result<Setting>>;
	/** SETTINGS_SQL.delete. Deleting a missing key is not an error. */
	delete(key: string): Promise<Result<void>>;
	/** SETTINGS_SQL.deleteByPrefix. Returns the number of rows removed. */
	deleteByPrefix(prefix: string): Promise<Result<number>>;
}

export function createSettingsRepository(_db: Database, _deps: RepositoryDeps): SettingsRepository {
	return {
		get: async () => notImplemented("DATA-01"),
		list: async () => notImplemented("DATA-01"),
		listByPrefix: async () => notImplemented("DATA-01"),
		set: async () => notImplemented("DATA-01"),
		delete: async () => notImplemented("DATA-01"),
		deleteByPrefix: async () => notImplemented("DATA-01"),
	};
}
