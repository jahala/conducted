/**
 * @feature catalogue A sql.js (SQLite compiled to WebAssembly) database for the states catalogue
 * Owns: opening an empty sql.js database, applying the app's migrations in order with the app's
 * pragmas, and handing it to the app's own statement queue. It takes the loaded sql.js module and the
 * migration texts as parameters, so the browser catalogue (sqlite.ts, through Vite) and Bun tools
 * (scripts/conductor-reference/catalogue.ts, from disk) open the same database the same way.
 * Behaviour: not applicable, a development tool. It mirrors src/test/sqlite.ts and src/test/node-sql.ts,
 * which do the same over node:sqlite for the tests.
 * Must handle: positional `$1..$n` parameters bind by name, as the app writes them; the queue is the one
 * the app runs (platform/queued-database.ts), so the catalogue sees the app's ordering and errors.
 * Test first: not applicable; the screenshot run (scripts/catalogue/shots.ts) opens every state on it.
 */
import type { Database as SqlJsDatabase, SqlJsStatic, SqlValue } from "sql.js";
import type { Database } from "../platform/platform.ts";
import {
	createQueuedDatabase,
	DATABASE_PRAGMAS,
	type SqlDatabase,
} from "../platform/queued-database.ts";

/** The app writes `$1..$n`; sql.js binds a name with its `$` prefix. */
const bind = (params: readonly unknown[]): Record<string, SqlValue> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value as SqlValue]));

/** The raw handle `db_execute` and `db_select` give the app, over sql.js. */
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
export function openSqlJsDatabase(SQL: SqlJsStatic, migrations: readonly string[]): Database {
	const db = new SQL.Database();
	for (const pragma of DATABASE_PRAGMAS) db.exec(pragma);
	for (const sql of migrations) db.exec(sql);
	return createQueuedDatabase(sqlJsHandle(db));
}
