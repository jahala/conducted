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
import { err, ok, type Result } from "@conducted/shared";
import type { z } from "zod";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	collectResults,
	executeStatement,
	executeVoid,
	inTransaction,
	parseJsonColumn,
	selectRows,
	stringifyJson,
} from "./row-codec.ts";

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
	/** FAVORITE_MODELS_SQL.reorder with the ids in their new order. */
	reorder(orderedIds: readonly string[]): Promise<Result<void>>;
	/** FAVORITE_MODELS_SQL.delete. */
	delete(id: string): Promise<Result<void>>;
}

export function createFavoriteModelRepository(
	db: Database,
	deps: RepositoryDeps,
): FavoriteModelRepository {
	return {
		list: async () => {
			const rows = await selectRows<FavoriteModelRow>(
				db,
				FAVORITE_MODELS_SQL.list,
				[],
				"Listing favorite models",
			);
			return rows.ok ? collectResults(rows.value.map(favoriteModelFromRow)) : err(rows.error);
		},
		add: async (config) =>
			inTransaction(db, "Saving a favorite model", async (tx) => {
				const next = await selectRows<{ next: number }>(
					tx,
					FAVORITE_MODELS_SQL.nextPosition,
					[],
					"Reading the next favorite model position",
				);
				if (!next.ok) return err(next.error);
				const model: FavoriteModel = {
					id: deps.ids.uuid(),
					config,
					position: next.value[0]?.next ?? 0,
				};
				const params = favoriteModelToParams(model);
				if (!params.ok) return err(params.error);
				const written = await executeStatement(
					tx,
					FAVORITE_MODELS_SQL.insert,
					params.value,
					"Saving a favorite model",
				);
				return written.ok ? ok(model) : err(written.error);
			}),
		reorder: async (orderedIds) => {
			const json = stringifyJson(orderedIds, "favorite_models.ids");
			if (!json.ok) return err(json.error);
			return executeVoid(
				db,
				FAVORITE_MODELS_SQL.reorder,
				[json.value],
				"Reordering favorite models",
			);
		},
		delete: (id) => executeVoid(db, FAVORITE_MODELS_SQL.delete, [id], "Removing a favorite model"),
	};
}
