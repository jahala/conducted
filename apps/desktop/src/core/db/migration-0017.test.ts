// @vitest-environment node
/**
 * @feature SET-02 Settings pages and settings search
 * Tests migration 0017: the app data folder keeps Conductor's stored setting name, and a value
 * written under our earlier key moves with it.
 * Test first: a settings row stored as conducted_root_path is conductor_root_path after 0017.
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

describe("SET-02 migration 0017", () => {
	it("moves a stored conducted_root_path value to conductor_root_path and leaves others", () => {
		const raw = new DatabaseSync(":memory:");
		for (const pragma of DATABASE_PRAGMAS) raw.exec(pragma);
		raw.exec(migration("0001_init"));
		raw
			.prepare(
				"INSERT INTO settings (key, value, updated_at) VALUES ('conducted_root_path', '\"/work/conducted\"', 1)",
			)
			.run();
		raw
			.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('theme', '\"dark\"', 1)")
			.run();

		raw.exec(migration("0017_root_path_key"));

		const rows = raw.prepare("SELECT key, value FROM settings ORDER BY key").all();
		expect(rows).toEqual([
			{ key: "conductor_root_path", value: '"/work/conducted"' },
			{ key: "theme", value: '"dark"' },
		]);
		raw.close();
	});
});
