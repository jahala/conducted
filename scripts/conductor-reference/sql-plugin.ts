/**
 * Tauri's SQL plugin (`plugin:sql|load`, `execute`, `select`, `close`) over in-memory sql.js
 * databases, with the answers the plugin's JavaScript side reads: `load` gives back the database name,
 * `execute` gives `[rowsAffected, lastInsertId]`, `select` gives one object per row.
 *
 * - A database is built once from a schema (SQL text) and rows, and every page session opens its own
 *   copy, so one page's writes never reach another.
 * - Values bind the way the plugin binds JSON: booleans as 1 and 0, objects and arrays as JSON text,
 *   a missing value as NULL. A statement written with `$1..$n` binds by name, one with `?` by position.
 * - A blob comes back as an array of byte values.
 * - A failing statement answers with SQLite's message, as the plugin does; the stand-in never invents a
 *   row.
 */
import type { Database as SqlJsDatabase, SqlJsStatic, SqlValue } from "./sqljs-types.ts";

export interface DatabaseSeed {
	/** The name the frontend passes as `db`, such as `sqlite:app.db`. */
	name: string;
	schema: string;
	/** Rows to insert, by table. Columns not given take their defaults. */
	rows?: Record<string, Record<string, unknown>[]>;
	/** Statements run after the rows, such as a counter row a migration would insert. */
	setup?: string[];
}

export type Answer = { ok: true; value: unknown } | { ok: false; error: string };

export interface SqlPlugin {
	/** True when `command` is one of this plugin's commands. */
	handles(command: string): boolean;
	call(command: string, args: Record<string, unknown>): Answer;
	close(): void;
}

const message = (cause: unknown): string =>
	cause instanceof Error ? cause.message : String(cause);

/** Turns one JSON value into what SQLite stores, as the plugin does. */
export function toSql(value: unknown): SqlValue {
	if (value === undefined || value === null) return null;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (typeof value === "number" || typeof value === "string") return value;
	if (typeof value === "bigint") return Number(value);
	return JSON.stringify(value);
}

function bindings(
	query: string,
	values: readonly unknown[],
): SqlValue[] | Record<string, SqlValue> {
	if (/\$\d+/.test(query)) {
		return Object.fromEntries(values.map((value, index) => [`$${index + 1}`, toSql(value)]));
	}
	return values.map(toSql);
}

const fromSql = (value: SqlValue): unknown =>
	value instanceof Uint8Array ? Array.from(value) : value;

/** Builds a database from its seed and returns its bytes, which `openSqlPlugin` copies per session. */
export function buildDatabase(SQL: SqlJsStatic, seed: DatabaseSeed): Uint8Array {
	const db = new SQL.Database();
	try {
		db.exec(seed.schema);
		for (const [table, rows] of Object.entries(seed.rows ?? {})) {
			for (const row of rows) {
				const columns = Object.keys(row);
				if (columns.length === 0) continue;
				const names = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(", ");
				const marks = columns.map(() => "?").join(", ");
				try {
					db.run(
						`INSERT INTO "${table}" (${names}) VALUES (${marks})`,
						columns.map((column) => toSql(row[column])),
					);
				} catch (cause) {
					throw new Error(`Seeding ${seed.name} table ${table} failed: ${message(cause)}`);
				}
			}
		}
		for (const statement of seed.setup ?? []) db.exec(statement);
		return db.export();
	} finally {
		db.close();
	}
}

/** Opens a fresh copy of each database and answers the plugin's commands against them. */
export function openSqlPlugin(
	SQL: SqlJsStatic,
	databases: readonly { name: string; bytes: Uint8Array }[],
): SqlPlugin {
	const open = new Map<string, SqlJsDatabase>(
		databases.map(({ name, bytes }) => [name, new SQL.Database(bytes)]),
	);
	const find = (args: Record<string, unknown>): SqlJsDatabase | string => {
		const name = String(args.db ?? "");
		return open.get(name) ?? `The reference has no database named "${name}".`;
	};
	const run = (args: Record<string, unknown>, work: (db: SqlJsDatabase) => unknown): Answer => {
		const db = find(args);
		if (typeof db === "string") return { ok: false, error: db };
		try {
			return { ok: true, value: work(db) };
		} catch (cause) {
			return { ok: false, error: message(cause) };
		}
	};
	const query = (args: Record<string, unknown>): [string, unknown[]] => [
		String(args.query ?? ""),
		Array.isArray(args.values) ? args.values : [],
	];

	const commands: Record<string, (args: Record<string, unknown>) => Answer> = {
		"plugin:sql|load": (args) => run(args, () => String(args.db)),
		"plugin:sql|close": (args) => run(args, () => true),
		"plugin:sql|execute": (args) =>
			run(args, (db) => {
				const [sql, values] = query(args);
				if (values.length === 0) db.exec(sql);
				else db.run(sql, bindings(sql, values));
				const lastInsertId = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
				return [db.getRowsModified(), lastInsertId];
			}),
		"plugin:sql|select": (args) =>
			run(args, (db) => {
				const [sql, values] = query(args);
				const statement = db.prepare(sql);
				try {
					statement.bind(bindings(sql, values));
					const rows: Record<string, unknown>[] = [];
					while (statement.step()) {
						const row = statement.getAsObject();
						rows.push(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, fromSql(v)])));
					}
					return rows;
				} finally {
					statement.free();
				}
			}),
	};
	return {
		handles: (command) => command in commands,
		call: (command, args) =>
			commands[command]?.(args) ?? { ok: false, error: `${command} is not a SQL command.` },
		close: () => {
			for (const db of open.values()) db.close();
			open.clear();
		},
	};
}
