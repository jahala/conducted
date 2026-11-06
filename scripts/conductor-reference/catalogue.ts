/**
 * Our states catalogue, seeded in Bun: each state's route, its world and every row its seed wrote. The
 * reference server hands these to the sample-data mapping, which turns our rows into Conductor's.
 *
 * - The seeds are the catalogue's own (apps/desktop/src/catalogue/seeded.ts), over the same sql.js
 *   database the browser catalogue opens (catalogue/sqljs.ts), with the migrations read from the folder
 *   the Rust shell applies.
 * - The desktop modules are imported by a path built at run time. They are typechecked with the desktop
 *   project (they use its JSX and DOM settings); here the shapes are checked when they load.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadSqlJs } from "./sqljs-types.ts";

export const ROOT = resolve(import.meta.dir, "../..");
const DESKTOP = join(ROOT, "apps/desktop");
const MIGRATIONS = join(DESKTOP, "src-tauri/migrations");

export interface StateInfo {
	id: string;
	group: string;
	title: string;
}

export interface SeededState extends StateInfo {
	scene: { route: string; start?: "ready" | "pending" | "fails"; after?: unknown };
	/** The catalogue's World: its repositories, memory Platform and scripted sidecar. */
	world: unknown;
	tables: Record<string, Record<string, unknown>[]>;
}

export interface Catalogue {
	states: StateInfo[];
	seed(id: string): Promise<SeededState>;
}

interface SeededModule {
	catalogueStates(): StateInfo[];
	seedState(id: string, database: unknown, theme: "light" | "dark"): Promise<SeededState>;
}
interface SqlJsModule {
	openSqlJsDatabase(SQL: unknown, migrations: readonly string[]): unknown;
}

const desktopModule = async <T>(path: string, exports: string[]): Promise<T> => {
	const loaded = (await import(join(DESKTOP, path))) as Record<string, unknown>;
	const missing = exports.filter((name) => typeof loaded[name] !== "function");
	if (missing.length > 0) throw new Error(`${path} does not export ${missing.join(", ")}.`);
	return loaded as T;
};

/** The app's migrations in file-name order, as the Rust shell applies them. */
export const readMigrations = (): string[] =>
	readdirSync(MIGRATIONS)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((name) => readFileSync(join(MIGRATIONS, name), "utf8"));

/** Loads the catalogue. Each `seed` call builds a fresh world over a fresh database, in dark theme. */
export async function loadCatalogue(): Promise<Catalogue> {
	const SQL = await loadSqlJs();
	const seeded = await desktopModule<SeededModule>("src/catalogue/seeded.ts", [
		"catalogueStates",
		"seedState",
	]);
	const sqljs = await desktopModule<SqlJsModule>("src/catalogue/sqljs.ts", ["openSqlJsDatabase"]);
	const migrations = readMigrations();
	return {
		states: seeded.catalogueStates(),
		seed: (id) => seeded.seedState(id, sqljs.openSqlJsDatabase(SQL, migrations), "dark"),
	};
}
