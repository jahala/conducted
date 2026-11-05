/**
 * @feature test support A node:sqlite handle shaped like tauri-plugin-sql
 * Owns: `createNodeSqlDatabase`, the `SqlDatabase` the app's statement queue wraps, over a
 * node:sqlite database, and `createNodeQueuedDatabase`, which wraps it in that queue.
 * Behaviour: not applicable, test support only.
 * Must handle: positional `$1..$n` parameters bind by name, as node:sqlite needs; the queue is the
 * one the app runs (platform/queued-database.ts), so a test sees the same ordering, the same
 * errors for nested and closed transactions and the same hang for a statement that waits on its
 * own transaction.
 * Test first: a statement made on the outer database inside a transaction waits for the commit.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Database } from "../platform/platform.ts";
import {
	createQueuedDatabase,
	type QueuedDatabaseOptions,
	type SqlDatabase,
} from "../platform/queued-database.ts";

/** node:sqlite binds `$1..$n` by name, so a positional list becomes `{ $1: ... }`. */
const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

/** The raw handle the plugin gives the app, over node:sqlite. */
export function createNodeSqlDatabase(db: DatabaseSync): SqlDatabase {
	return {
		execute: async (sql, params = []) => {
			const result = db.prepare(sql).run(bind(params));
			return {
				rowsAffected: Number(result.changes),
				lastInsertId: Number(result.lastInsertRowid),
			};
		},
		select: async <Rows>(sql: string, params: unknown[] = []) =>
			db.prepare(sql).all(bind(params)) as Rows,
	};
}

/** The app's `Database` over node:sqlite: the real queue on a real SQLite. */
export function createNodeQueuedDatabase(
	db: DatabaseSync,
	options: QueuedDatabaseOptions = {},
): Database {
	return createQueuedDatabase(createNodeSqlDatabase(db), options);
}
