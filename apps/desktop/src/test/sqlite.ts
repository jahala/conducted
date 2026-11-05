/**
 * @feature test support An in-memory SQLite database for tests
 * Owns: opening a node:sqlite database, applying every migration in order, and exposing it
 * behind the same `Database` interface the platform uses.
 * Behaviour: not applicable, test support only.
 * Must handle: the adapter binds positional `$1..$n` parameters by name and rolls a failed
 * transaction back, so tests see the same database the Tauri plugin gives the app.
 * Test first: a test database accepts every statement the app prepares.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Database } from "../platform/platform.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../src-tauri/migrations/", import.meta.url));
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
	.filter((name) => name.endsWith(".sql"))
	.sort()
	.map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"));

/** node:sqlite binds `$1..$n` by name, so a positional list becomes `{ $1: ... }`. */
const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

/** The same Database interface the Tauri plugin offers, over node:sqlite. */
class NodeDatabase implements Database {
	readonly #db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.#db = db;
	}

	async execute(sql: string, params: readonly unknown[] = []) {
		const result = this.#db.prepare(sql).run(bind(params));
		return {
			rowsAffected: Number(result.changes),
			lastInsertId: Number(result.lastInsertRowid),
		};
	}

	async select<Row>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
		return this.#db.prepare(sql).all(bind(params)) as Row[];
	}

	async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const value = await work(this);
			this.#db.exec("COMMIT");
			return value;
		} catch (cause) {
			this.#db.exec("ROLLBACK");
			throw cause;
		}
	}
}

export interface TestDatabase {
	/** The database behind the platform interface. */
	database: Database;
	/** The raw handle, for tests that assert on SQL directly. */
	raw: DatabaseSync;
	/** Closes the database. Safe to call once. */
	close(): void;
}

/** A fresh in-memory database with every migration applied in order. */
export function openTestDatabase(): TestDatabase {
	const raw = new DatabaseSync(":memory:");
	for (const sql of MIGRATIONS) raw.exec(sql);
	return { database: new NodeDatabase(raw), raw, close: () => raw.close() };
}
