// @vitest-environment node
/**
 * @feature SET-02 Settings pages and settings search
 * Tests migration 0014: the General setting that expands tool calls keeps Conductor's stored
 * name, and a value written under our earlier key moves with it.
 * Test first: a settings row stored as expand_tool_calls is garry_mode after migration 0014.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DATABASE_PRAGMAS } from "../../platform/queued-database.ts";

const MIGRATIONS_DIR =
	[
		resolve(process.cwd(), "src-tauri/migrations"),
		resolve(process.cwd(), "apps/desktop/src-tauri/migrations"),
	].find((dir) => existsSync(dir)) ?? resolve(process.cwd(), "src-tauri/migrations");

const migration = (name: string): string =>
	readFileSync(join(MIGRATIONS_DIR, `${name}.sql`), "utf8");

describe("SET-02 migration 0014", () => {
	it("moves a stored expand_tool_calls value to garry_mode and leaves other settings", () => {
		const raw = new DatabaseSync(":memory:");
		for (const pragma of DATABASE_PRAGMAS) raw.exec(pragma);
		raw.exec(migration("0001_init"));
		raw
			.prepare(
				"INSERT INTO settings (key, value, updated_at) VALUES ('expand_tool_calls', 'true', 1)",
			)
			.run();
		raw
			.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('theme', '\"dark\"', 1)")
			.run();

		raw.exec(migration("0014_settings_garry_mode"));

		const rows = raw.prepare("SELECT key, value FROM settings ORDER BY key").all();
		expect(rows).toEqual([
			{ key: "garry_mode", value: "true" },
			{ key: "theme", value: '"dark"' },
		]);
		raw.close();
	});
});
