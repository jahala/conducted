/**
 * @feature test support An in-memory SQLite database for tests
 * Owns: opening a node:sqlite database, applying every migration in order, and exposing it
 * behind the same `Database` interface the platform uses.
 * Behaviour: not applicable, test support only.
 * Must handle: the database is the app's own statement queue (platform/queued-database.ts) over
 * node:sqlite, with the same pragmas. A test therefore sees what the app sees: a statement on the
 * outer database inside a transaction waits for that transaction and so never finishes, two
 * overlapping transactions run one after the other, and a nested transaction is refused.
 * Test first: a test database accepts every statement the app prepares.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Database } from "../platform/platform.ts";
import { DATABASE_PRAGMAS } from "../platform/queued-database.ts";
import { createNodeQueuedDatabase } from "./node-sql.ts";

/**
 * Under vitest's jsdom environment `import.meta.url` is not a file URL, so the folder is found from
 * the working directory instead. `pnpm --filter` and `pnpm -r` run vitest in apps/desktop; a run
 * from the repository root finds it by its full path.
 */
const MIGRATIONS_DIR =
	[
		resolve(process.cwd(), "src-tauri/migrations"),
		resolve(process.cwd(), "apps/desktop/src-tauri/migrations"),
	].find((dir) => existsSync(dir)) ?? resolve(process.cwd(), "src-tauri/migrations");
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
	.filter((name) => name.endsWith(".sql"))
	.sort()
	.map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"));

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
	for (const pragma of DATABASE_PRAGMAS) raw.exec(pragma);
	for (const sql of MIGRATIONS) raw.exec(sql);
	return { database: createNodeQueuedDatabase(raw), raw, close: () => raw.close() };
}
