// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createQueuedDatabase } from "../platform/queued-database.ts";
import { createNodeSqlDatabase } from "./node-sql.ts";
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

/** The test database's queue over a node:sqlite handle that records every statement it runs. */
function recordedDatabase() {
	const raw = new DatabaseSync(":memory:");
	raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
	const sql = createNodeSqlDatabase(raw);
	const statements: string[] = [];
	const database = createQueuedDatabase({
		execute: (query, values) => {
			statements.push(query);
			return sql.execute(query, values);
		},
		select: (query, values) => {
			statements.push(query);
			return sql.select(query, values);
		},
	});
	return { database, statements, close: () => raw.close() };
}

/** Lets every queued promise step run. The SQLite handle is synchronous, so nothing else is pending. */
const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("test database queue (the app's own)", () => {
	it("runs an outer select made inside a transaction after the commit", async () => {
		const test = recordedDatabase();
		try {
			let outer: Promise<unknown[]> = Promise.resolve([]);
			await test.database.transaction(async (tx) => {
				await tx.execute("INSERT INTO t (id) VALUES ($1)", [1]);
				// Started inside the work and not awaited there. Awaiting it would never finish.
				outer = test.database.select("SELECT id FROM t /* outer */");
				await tx.select("SELECT id FROM t /* inner */");
			});
			expect(await outer).toEqual([{ id: 1 }]);
			expect(test.statements).toEqual([
				"BEGIN IMMEDIATE",
				"INSERT INTO t (id) VALUES ($1)",
				"SELECT id FROM t /* inner */",
				"COMMIT",
				"SELECT id FROM t /* outer */",
			]);
		} finally {
			test.close();
		}
	});

	it("never finishes a transaction whose work awaits the outer database", async () => {
		// The app hangs the same way: the select waits behind the transaction that waits for it.
		// The queue cannot tell this caller from an unrelated one, so it cannot fail fast.
		const test = recordedDatabase();
		try {
			let settled = false;
			const stuck = test.database
				.transaction(async () => {
					await test.database.select("SELECT id FROM t /* outer */");
				})
				.then(
					() => {
						settled = true;
					},
					() => {
						settled = true;
					},
				);
			await drain();
			expect(settled).toBe(false);
			expect(test.statements).toEqual(["BEGIN IMMEDIATE"]);
			void stuck;
		} finally {
			test.close();
		}
	});

	it("runs two overlapping transactions one after the other", async () => {
		const test = recordedDatabase();
		try {
			let release: () => void = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			let firstHasStarted: () => void = () => {};
			const firstStarted = new Promise<void>((resolve) => {
				firstHasStarted = resolve;
			});
			const first = test.database.transaction(async (tx) => {
				await tx.execute("INSERT INTO t (id) VALUES ($1)", [1]);
				firstHasStarted();
				await gate;
			});
			await firstStarted;
			const second = test.database.transaction(async (tx) => {
				await tx.execute("INSERT INTO t (id) VALUES ($1)", [2]);
			});
			await drain();
			expect(test.statements).toEqual(["BEGIN IMMEDIATE", "INSERT INTO t (id) VALUES ($1)"]);

			release();
			await Promise.all([first, second]);
			expect(test.statements).toEqual([
				"BEGIN IMMEDIATE",
				"INSERT INTO t (id) VALUES ($1)",
				"COMMIT",
				"BEGIN IMMEDIATE",
				"INSERT INTO t (id) VALUES ($1)",
				"COMMIT",
			]);
			expect(await test.database.select("SELECT id FROM t ORDER BY id")).toEqual([
				{ id: 1 },
				{ id: 2 },
			]);
		} finally {
			test.close();
		}
	});

	it("refuses a transaction started inside a transaction, and rolls the outer one back", async () => {
		const test = openTestDatabase();
		try {
			await expect(
				test.database.transaction(async (tx) => {
					await tx.execute(PUT, ["lost", "1", 1]);
					await tx.transaction(async () => {});
				}),
			).rejects.toMatchObject({ code: "transaction_nested" });
			expect(await test.database.select(ALL)).toEqual([]);
		} finally {
			test.close();
		}
	});

	it("rejects a transaction handle kept past the commit", async () => {
		const test = openTestDatabase();
		try {
			let kept: Parameters<Parameters<typeof test.database.transaction>[0]>[0] | null = null;
			await test.database.transaction(async (tx) => {
				kept = tx;
			});
			await expect(
				(kept as unknown as typeof test.database).execute(PUT, ["late", "1", 1]),
			).rejects.toMatchObject({ code: "transaction_closed" });
			expect(await test.database.select(ALL)).toEqual([]);
		} finally {
			test.close();
		}
	});
});
