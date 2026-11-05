// @vitest-environment node
import { describe, expect, it } from "vitest";
import { openTestDatabase } from "./sqlite.ts";

const PUT = "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)";
const ALL = "SELECT key, value FROM settings ORDER BY key";

describe("test database", () => {
	it("applies every migration in order", async () => {
		const test = openTestDatabase();
		try {
			const tables = await test.database.select<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table'",
			);
			const names = tables.map((table) => table.name);
			// repos is made by 0001; the rebuilt attachments and the keys table by 0004.
			for (const name of ["repos", "settings", "attachments", "provider_keys"]) {
				expect(names).toContain(name);
			}
			expect(names).not.toContain("attachments_before_0004");
		} finally {
			test.close();
		}
	});

	it("binds positional parameters in order", async () => {
		const test = openTestDatabase();
		try {
			const written = await test.database.execute(PUT, ["theme", '"dark"', 7]);
			expect(written.rowsAffected).toBe(1);
			const rows = await test.database.select<{ key: string; value: string }>(ALL);
			expect(rows).toEqual([{ key: "theme", value: '"dark"' }]);
		} finally {
			test.close();
		}
	});

	it("enforces constraints the real database enforces", async () => {
		const test = openTestDatabase();
		try {
			await test.database.execute(PUT, ["theme", '"dark"', 7]);
			await expect(test.database.execute(PUT, ["theme", '"light"', 8])).rejects.toThrow();
			// Every column is given, so only the foreign key to repos can refuse this row.
			await expect(
				test.database.execute(
					"INSERT INTO env_vars (name, scope, repo_id, keychain_ref) VALUES ($1, $2, $3, $4)",
					["KEY", "repo", "no-such-repo", "ref"],
				),
			).rejects.toThrow(/FOREIGN KEY/i);
		} finally {
			test.close();
		}
	});

	it("commits a transaction that finishes", async () => {
		const test = openTestDatabase();
		try {
			await test.database.transaction(async (db) => {
				await db.execute(PUT, ["a", "1", 1]);
				await db.execute(PUT, ["b", "2", 1]);
			});
			expect((await test.database.select(ALL)).length).toBe(2);
		} finally {
			test.close();
		}
	});

	it("rolls a failed transaction back and hands the error on", async () => {
		const test = openTestDatabase();
		try {
			await test.database.execute(PUT, ["kept", "1", 1]);
			await expect(
				test.database.transaction(async (db) => {
					await db.execute(PUT, ["lost", "2", 1]);
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			const rows = await test.database.select<{ key: string }>(ALL);
			expect(rows.map((row) => row.key)).toEqual(["kept"]);
		} finally {
			test.close();
		}
	});

	it("gives every call its own database", async () => {
		const first = openTestDatabase();
		const second = openTestDatabase();
		try {
			await first.database.execute(PUT, ["only-first", "1", 1]);
			expect(await second.database.select(ALL)).toEqual([]);
		} finally {
			first.close();
			second.close();
		}
	});
});
