// @vitest-environment node
/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests migration 0019: a workspace stores its Sync files switch. A cloud workspace written before
 * the migration keeps the value it showed then, the Advanced setting's; a local one stores 0.
 * Test first: a cloud row reads the stored setting's value and a local row reads 0.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DATABASE_PRAGMAS } from "../../platform/queued-database.ts";

const MIGRATIONS_DIR =
	[
		resolve(process.cwd(), "src-tauri/migrations"),
		resolve(process.cwd(), "apps/desktop/src-tauri/migrations"),
	].find((dir) => existsSync(dir)) ?? resolve(process.cwd(), "src-tauri/migrations");

const THIS_MIGRATION = "0019_workspace_remote_file_sync.sql";

/** A database at version 18, with one local and one cloud workspace and the setting as given. */
function databaseBefore(storedSetting: string | null): DatabaseSync {
	const raw = new DatabaseSync(":memory:");
	for (const pragma of DATABASE_PRAGMAS) raw.exec(pragma);
	for (const name of readdirSync(MIGRATIONS_DIR).sort()) {
		if (name.endsWith(".sql") && name < THIS_MIGRATION) {
			raw.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
		}
	}
	raw.exec(`INSERT INTO repos (id, name, root_path, default_branch, created_at, updated_at)
		VALUES ('repo-1', 'atlas', '/code/atlas', 'main', 1, 1)`);
	raw.exec(`INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state,
			port, last_activity_at, created_at, updated_at)
		VALUES ('ws-local', 'repo-1', 'oslo', '/code/oslo', 'jahala/oslo', 'origin/main', 'ready',
			55000, 1, 1, 1)`);
	raw.exec(`INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state,
			port, host_kind, host_url, host_vm_id, last_activity_at, created_at, updated_at)
		VALUES ('ws-cloud', 'repo-1', 'lima', '/workspace/lima', 'jahala/lima', 'origin/main', 'ready',
			0, 'cloud', 'https://w.example.dev', 'lima', 1, 1, 1)`);
	if (storedSetting !== null) {
		raw
			.prepare(
				"INSERT INTO settings (key, value, updated_at) VALUES ('auto_sync_files_in_new_cloud_workspaces', ?, 1)",
			)
			.run(storedSetting);
	}
	return raw;
}

function switchesAfter(storedSetting: string | null): Record<string, number> {
	const raw = databaseBefore(storedSetting);
	raw.exec(readFileSync(join(MIGRATIONS_DIR, THIS_MIGRATION), "utf8"));
	const rows = raw
		.prepare("SELECT id, remote_file_sync_enabled FROM workspaces ORDER BY id")
		.all() as { id: string; remote_file_sync_enabled: number }[];
	raw.close();
	return Object.fromEntries(rows.map((row) => [row.id, row.remote_file_sync_enabled]));
}

describe("CLOUD-11 migration 0019", () => {
	it("keeps a cloud workspace on when the setting was never changed, its default", () => {
		expect(switchesAfter(null)).toEqual({ "ws-cloud": 1, "ws-local": 0 });
	});

	it("keeps a cloud workspace off when the setting was turned off", () => {
		expect(switchesAfter("false")).toEqual({ "ws-cloud": 0, "ws-local": 0 });
	});

	it("keeps a cloud workspace on when the setting is stored on", () => {
		expect(switchesAfter("true")).toEqual({ "ws-cloud": 1, "ws-local": 0 });
	});

	it("stores only 0 or 1", () => {
		const raw = databaseBefore(null);
		raw.exec(readFileSync(join(MIGRATIONS_DIR, THIS_MIGRATION), "utf8"));
		expect(() =>
			raw.exec("UPDATE workspaces SET remote_file_sync_enabled = 2 WHERE id = 'ws-local'"),
		).toThrow(/CHECK constraint failed/);
		raw.close();
	});
});
