/**
 * @feature DATA-01 Repository for the favorite_models table
 * Owns: the model choices the user saved for the model picker.
 * Behaviour: services-map.md 2.3.5 (favorite_models: list, upsert, reorder, delete, ordered by
 * position). Our table has one JSON config column instead of scope columns.
 * Must handle: a bad config column returns an error Result; positions are 0-based and rewritten
 * from a JSON list on reorder; adding appends after the last position in one transaction.
 * Test first: favoriteModelFromRow returns an error Result when config lacks a model name.
 */
import { zSessionConfig } from "@conducted/protocol";
import { notImplemented, type Result } from "@conducted/shared";
import type { z } from "zod";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import { parseJsonColumn, stringifyJson } from "./row-codec.ts";

/** The part of a chat's config that identifies a model choice. */
export const zFavoriteModelConfig = zSessionConfig.pick({
	agent: true,
	acpAgent: true,
	model: true,
	effort: true,
	fastMode: true,
});
export type FavoriteModelConfig = z.infer<typeof zFavoriteModelConfig>;

export interface FavoriteModel {
	id: string;
	config: FavoriteModelConfig;
	position: number;
}

export interface FavoriteModelRow {
	id: string;
	config: string;
	position: number;
}

export function favoriteModelFromRow(row: FavoriteModelRow): Result<FavoriteModel> {
	const config = parseJsonColumn(row.config, zFavoriteModelConfig, "favorite_models.config");
	if (!config.ok) return config;
	return { ok: true, value: { id: row.id, config: config.value, position: row.position } };
}

/** Parameters for FAVORITE_MODELS_SQL.insert, in column order. */
export function favoriteModelToParams(model: FavoriteModel): Result<readonly unknown[]> {
	const config = stringifyJson(model.config, "favorite_models.config");
	if (!config.ok) return config;
	return { ok: true, value: [model.id, config.value, model.position] };
}

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const FAVORITE_MODELS_SQL = {
	list: "SELECT id, config, position FROM favorite_models ORDER BY position, id",
	get: "SELECT id, config, position FROM favorite_models WHERE id = $1",
	nextPosition: "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM favorite_models",
	insert: "INSERT INTO favorite_models (id, config, position) VALUES ($1, $2, $3)",
	setConfig: "UPDATE favorite_models SET config = $1 WHERE id = $2",
	/** `$1` is a JSON list of favorite ids in their new order. */
	reorder: `UPDATE favorite_models
		SET position = (SELECT CAST(j.key AS INTEGER) FROM json_each($1) j WHERE j.value = favorite_models.id)
		WHERE id IN (SELECT value FROM json_each($1))`,
	delete: "DELETE FROM favorite_models WHERE id = $1",
} as const;

export interface FavoriteModelRepository {
	/** FAVORITE_MODELS_SQL.list. */
	list(): Promise<Result<FavoriteModel[]>>;
	/** FAVORITE_MODELS_SQL.nextPosition then FAVORITE_MODELS_SQL.insert, in one transaction. */
	add(config: FavoriteModelConfig): Promise<Result<FavoriteModel>>;
	/** FAVORITE_MODELS_SQL.setConfig. `ok(false)` when the favorite is gone. */
	setConfig(id: string, config: FavoriteModelConfig): Promise<Result<boolean>>;
	/** FAVORITE_MODELS_SQL.reorder with the ids in their new order. */
	reorder(orderedIds: readonly string[]): Promise<Result<void>>;
	/** FAVORITE_MODELS_SQL.delete. */
	delete(id: string): Promise<Result<void>>;
}

export function createFavoriteModelRepository(
	_db: Database,
	_deps: RepositoryDeps,
): FavoriteModelRepository {
	return {
		list: async () => notImplemented("DATA-01"),
		add: async () => notImplemented("DATA-01"),
		setConfig: async () => notImplemented("DATA-01"),
		reorder: async () => notImplemented("DATA-01"),
		delete: async () => notImplemented("DATA-01"),
	};
}
