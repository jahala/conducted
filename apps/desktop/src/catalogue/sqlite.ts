/**
 * @feature catalogue A real SQLite in the browser for the states catalogue
 * Owns: opening a sql.js (SQLite compiled to WebAssembly) database, applying the app's migrations in
 * order with the app's pragmas, and handing it to the app's own statement queue.
 * Behaviour: not applicable, a development tool. It mirrors src/test/sqlite.ts and src/test/node-sql.ts,
 * which do the same over node:sqlite for the tests.
 * Must handle: positional `$1..$n` parameters bind by name, as the app writes them; the queue is the one
 * the app runs (platform/queued-database.ts), so the catalogue sees the app's ordering and errors.
 * Test first: not applicable; the screenshot run (scripts/catalogue/shots.ts) opens every state on it.
 */
import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import type { Database } from "../platform/platform.ts";
import {
	createQueuedDatabase,
	DATABASE_PRAGMAS,
	type SqlDatabase,
} from "../platform/queued-database.ts";

/** The app's migrations, read by Vite at build time from the folder the Rust shell applies. */
const MIGRATIONS: readonly string[] = Object.entries(
	import.meta.glob<string>("../../src-tauri/migrations/*.sql", {
		query: "?raw",
		import: "default",
		eager: true,
	}),
)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, sql]) => sql);

/** The app writes `$1..$n`; sql.js binds a name with its `$` prefix. */
const bind = (params: readonly unknown[]): Record<string, SqlValue> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value as SqlValue]));

/** The raw handle the plugin gives the app, over sql.js. */
function sqlJsHandle(db: SqlJsDatabase): SqlDatabase {
	return {
		execute: async (sql, params = []) => {
			db.run(sql, bind(params));
			const rowsAffected = db.getRowsModified();
			const lastInsertId = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
			return { rowsAffected, lastInsertId };
		},
		select: async <Rows>(sql: string, params: unknown[] = []) => {
			const statement = db.prepare(sql);
			try {
				statement.bind(bind(params));
				const rows: Record<string, SqlValue>[] = [];
				while (statement.step()) rows.push(statement.getAsObject());
				return rows as Rows;
			} finally {
				statement.free();
			}
		},
	};
}

/** A fresh in-memory database with every migration applied, behind the app's statement queue. */
export async function openCatalogueDatabase(): Promise<Database> {
	const SQL = await initSqlJs({ locateFile: () => wasmUrl });
	const db = new SQL.Database();
	for (const pragma of DATABASE_PRAGMAS) db.exec(pragma);
	for (const sql of MIGRATIONS) db.exec(sql);
	return createQueuedDatabase(sqlJsHandle(db));
}
