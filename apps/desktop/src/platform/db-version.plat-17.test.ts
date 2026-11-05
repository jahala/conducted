import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
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

describe("PLAT-17 database opening", () => {
	it("PLAT-17 leaves the database closed until the first statement", async () => {
		let loads = 0;
		const db = createLazyTauriDatabase({
			sql: {
				load: async () => {
					loads += 1;
					return {
						execute: async () => ({ rowsAffected: 0 }),
						select: async <Rows>(): Promise<Rows> => [] as unknown as Rows,
					};
				},
			},
		});

		expect(loads).toBe(0);
		await db.execute("PRAGMA user_version");
		await db.execute("PRAGMA user_version");
		expect(loads).toBe(1);
	});

	it("PLAT-17 hands a failed database load to the first statement", async () => {
		const failure = { code: "sql_load_failed", message: "the database is locked" };
		const db = createLazyTauriDatabase({
			sql: {
				load: async () => {
					throw failure;
				},
			},
		});

		await expect(db.execute("PRAGMA user_version")).rejects.toEqual(failure);
	});
});
