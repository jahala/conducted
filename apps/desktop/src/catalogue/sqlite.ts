/**
 * @feature catalogue A real SQLite in the browser for the states catalogue
 * Owns: loading sql.js and the app's migrations through Vite, and opening the catalogue's database with
 * them (sqljs.ts does the opening).
 * Behaviour: not applicable, a development tool.
 * Must handle: the migrations are the folder the Rust shell applies, in file-name order.
 * Test first: not applicable; the screenshot run (scripts/catalogue/shots.ts) opens every state on it.
 */
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import type { Database } from "../platform/platform.ts";
import { openSqlJsDatabase } from "./sqljs.ts";

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

/** A fresh in-memory database with every migration applied, behind the app's statement queue. */
export async function openCatalogueDatabase(): Promise<Database> {
	const SQL = await initSqlJs({ locateFile: () => wasmUrl });
	return openSqlJsDatabase(SQL, MIGRATIONS);
}
