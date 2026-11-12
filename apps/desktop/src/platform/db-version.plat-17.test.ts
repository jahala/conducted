import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { databaseCommands } from "../test/database-commands.ts";
import { DATABASE_PRAGMAS, type SqlDatabase } from "./queued-database.ts";
import {
	COMMANDS,
	createLazyTauriDatabase,
	createTauriAppInfo,
	type TauriBindings,
} from "./tauri.ts";

interface DbVersionAnswer {
	state: "ok" | "fresh" | "failed_migration" | "database_newer";
	appVersion: number;
	dbVersion: number | null;
	message: string | null;
}

const answer = (
	state: DbVersionAnswer["state"],
	dbVersion: number | null,
	appVersion = 4,
	message: string | null = null,
): DbVersionAnswer => ({ state, appVersion, dbVersion, message });

const bindingsFor = (
	reply: DbVersionAnswer | (() => never),
	calls: string[] = [],
): TauriBindings => ({
	invoke: async <T>(command: string): Promise<T> => {
		calls.push(command);
		if (typeof reply === "function") return reply();
		return reply as T;
	},
	listen: async () => () => {},
});

const appInfo = (bindings: TauriBindings) =>
	createTauriAppInfo(bindings, { version: "0.0.0-test", channel: "dev" });

describe("PLAT-17 database version warning", () => {
	it("PLAT-17 asks db_version_check and reports a newer database with both versions", async () => {
		const calls: string[] = [];
		const app = appInfo(bindingsFor(answer("database_newer", 7, 4, "Update Conducted."), calls));

		await expect(app.dbVersionWarning()).resolves.toEqual(
			ok({ databaseVersion: 7, appVersion: 4 }),
		);
		expect(calls).toEqual([COMMANDS.dbVersionCheck]);
	});

	it("PLAT-17 treats a database this app knows as no warning", async () => {
		const app = appInfo(bindingsFor(answer("ok", 4)));

		await expect(app.dbVersionWarning()).resolves.toEqual(ok(null));
	});

	it("PLAT-17 treats a fresh database as no warning", async () => {
		const app = appInfo(bindingsFor(answer("fresh", null)));

		await expect(app.dbVersionWarning()).resolves.toEqual(ok(null));
	});

	it("PLAT-17 passes a failed migration to startup as an error", async () => {
		const app = appInfo(
			bindingsFor(answer("failed_migration", 1, 4, "A database upgrade did not finish.")),
		);

		const result = await app.dbVersionWarning();

		expect(result).toMatchObject({ ok: false, error: { code: "db_migration_failed" } });
	});

	it("PLAT-17 refuses a newer answer that does not name the database version", async () => {
		const app = appInfo(bindingsFor(answer("database_newer", null)));

		const result = await app.dbVersionWarning();

		expect(result).toMatchObject({ ok: false, error: { code: "db_version_unreadable" } });
	});

	it("PLAT-17 passes a rejected command on instead of inventing a version", async () => {
		const failure = { code: "db_read_failed", message: "The database could not be read." };
		const app = appInfo(
			bindingsFor(() => {
				throw failure;
			}),
		);

		const result = await app.dbVersionWarning();

		expect(result).toEqual({ ok: false, error: failure });
	});
});

/** The handle of a database that never opens, so no statement reaches it. */
const unusedSql: SqlDatabase = {
	execute: async () => {
		throw new Error("The database did not open, so no statement may reach it.");
	},
	select: async () => {
		throw new Error("The database did not open, so no statement may reach it.");
	},
};

describe("PLAT-17 database opening", () => {
	it("PLAT-17 leaves the database closed until the first statement", async () => {
		let loads = 0;
		const sql: SqlDatabase = {
			execute: async () => ({ rowsAffected: 0 }),
			select: async <Rows>(): Promise<Rows> => [] as unknown as Rows,
		};
		const db = createLazyTauriDatabase({
			invoke: databaseCommands(sql, async () => {
				loads += 1;
			}),
		});

		expect(loads).toBe(0);
		await db.execute("PRAGMA user_version");
		await db.execute("PRAGMA user_version");
		expect(loads).toBe(1);
	});

	it("PLAT-17 hands a failed database load to the first statement", async () => {
		const failure = { code: "db_open_failed", message: "the database is locked" };
		const db = createLazyTauriDatabase({
			invoke: databaseCommands(unusedSql, async () => {
				throw failure;
			}),
		});

		await expect(db.execute("PRAGMA user_version")).rejects.toEqual(failure);
	});

	it("PLAT-17 tries the load again after a failed one, so Retry can open the database", async () => {
		const failure = { code: "db_open_failed", message: "the database is locked" };
		const statements: string[] = [];
		const opened: SqlDatabase = {
			execute: async (sql) => {
				statements.push(sql);
				return { rowsAffected: 0 };
			},
			select: async <Rows>(): Promise<Rows> => [] as unknown as Rows,
		};
		let loads = 0;
		const db = createLazyTauriDatabase({
			invoke: databaseCommands(opened, async () => {
				loads += 1;
				if (loads === 1) throw failure;
			}),
		});

		await expect(db.execute("PRAGMA user_version")).rejects.toEqual(failure);
		await expect(db.execute("SELECT 1")).resolves.toEqual({ rowsAffected: 0 });
		await db.execute("SELECT 2");

		expect(loads).toBe(2);
		expect(statements).toEqual([...DATABASE_PRAGMAS, "SELECT 1", "SELECT 2"]);
	});

	it("PLAT-17 shares one failed load between statements that wait on it together", async () => {
		const failure = { code: "db_open_failed", message: "the database is locked" };
		let loads = 0;
		const db = createLazyTauriDatabase({
			invoke: databaseCommands(unusedSql, async () => {
				loads += 1;
				throw failure;
			}),
		});

		const together = await Promise.allSettled([db.execute("SELECT 1"), db.execute("SELECT 2")]);

		expect(together).toEqual([
			{ status: "rejected", reason: failure },
			{ status: "rejected", reason: failure },
		]);
		expect(loads).toBe(1);
	});
});
