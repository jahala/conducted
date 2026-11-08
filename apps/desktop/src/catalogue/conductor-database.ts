/**
 * @feature APP-17 Import from Conductor: a made-up Conductor database for the catalogue
 * Owns: `seedConductorDatabase`, which builds a Conductor database in the browser with sql.js from
 * the import's own schema (test/conductor-schema.ts), inserts the given rows, reads every table
 * back and seeds it where the import looks for Conductor's database on the made-up Mac.
 * Behaviour: the same steps as test/conductor-fixture.ts, which needs Node's SQLite; the catalogue
 * runs in a browser, so it uses the sql.js build the catalogue's own database uses (sqlite.ts).
 * Must handle: a table with no rows is still created, so it reads as an empty list.
 */
import initSqlJs, { type SqlValue } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import { conductorDatabasePath } from "../core/conductor-import/plan.ts";
import { CONDUCTOR_FIXTURE_SCHEMA } from "../test/conductor-schema.ts";
import type { World } from "./world.ts";
import { HOME } from "./world.ts";

export type ConductorRows = Partial<Record<string, readonly Readonly<Record<string, SqlValue>>[]>>;

/** Builds the database from `rows` and seeds it as this Mac's Conductor database. */
export async function seedConductorDatabase(world: World, rows: ConductorRows): Promise<void> {
	const SQL = await initSqlJs({ locateFile: () => wasmUrl });
	const db = new SQL.Database();
	try {
		db.exec(CONDUCTOR_FIXTURE_SCHEMA);
		for (const [table, tableRows] of Object.entries(rows)) {
			for (const row of tableRows ?? []) {
				const columns = Object.keys(row);
				db.run(
					`INSERT INTO "${table}" (${columns.map((name) => `"${name}"`).join(", ")})
					VALUES (${columns.map(() => "?").join(", ")})`,
					columns.map((name) => row[name] ?? null),
				);
			}
		}
		const tables = (
			db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]?.values ?? []
		).map((row) => String(row[0]));
		const read = (table: string) => {
			const result = db.exec(`SELECT * FROM "${table}" ORDER BY rowid`)[0];
			if (result === undefined) return [];
			return result.values.map((values) =>
				Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
			);
		};
		world.memory.controls.seedConductorDatabase(
			conductorDatabasePath(HOME),
			Object.fromEntries(tables.map((table) => [table, read(table)])),
		);
	} finally {
		db.close();
	}
}
