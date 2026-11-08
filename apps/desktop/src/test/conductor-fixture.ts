/**
 * @feature test support A made-up Conductor database for the import's tests (APP-17)
 * Owns: `buildConductorFixture`, which runs our own CREATE statements for Conductor's tables
 * (conductor-schema.ts) on a real SQLite, inserts the
 * given rows and reads every table back, so the rows a test hands the import carry the column
 * defaults and types SQLite gives them. The result seeds the in-memory Platform's Conductor
 * database or the Node bindings' real file.
 * Behaviour: the column names and defaults follow Conductor's schema as the lead exported it
 * (table and column definitions only, no data); docs/research/conductor/services-map.md 2.2.
 * Must handle: a row naming a column the schema does not have fails, as SQLite does; a table
 * with no rows is still created, so it reads as an empty list and not as a missing table.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { MemoryConductorDatabase } from "../platform/memory.ts";
import { CONDUCTOR_FIXTURE_SCHEMA } from "./conductor-schema.ts";

export type ConductorFixtureRows = Partial<
	Record<string, readonly Readonly<Record<string, SQLInputValue>>[]>
>;

/** Runs the schema, inserts `rows` and reads every table back, as the copy's read would. */
export function buildConductorFixture(rows: ConductorFixtureRows): MemoryConductorDatabase {
	const db = new DatabaseSync(":memory:");
	try {
		db.exec(CONDUCTOR_FIXTURE_SCHEMA);
		for (const [table, tableRows] of Object.entries(rows)) {
			for (const row of tableRows ?? []) {
				const columns = Object.keys(row);
				db.prepare(
					`INSERT INTO "${table}" (${columns.map((name) => `"${name}"`).join(", ")})
					VALUES (${columns.map(() => "?").join(", ")})`,
				).run(...columns.map((name) => row[name] ?? null));
			}
		}
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((row) => String(row.name));
		return Object.fromEntries(
			tables.map((table) => [
				table,
				db
					.prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
					.all()
					.map((row) => ({ ...row })),
			]),
		);
	} finally {
		db.close();
	}
}
