// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type ContractHarness, runPlatformContract } from "./contract.ts";
import { createMemoryPlatform } from "./memory.ts";
import type { Database } from "./platform.ts";

const bind = (params: readonly unknown[] = []): Record<string, unknown> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]));

/** A thin adapter over node:sqlite. The stand-in gets a real database, never a fake. */
function createDatabase(db: DatabaseSync): Database {
	let tail: Promise<unknown> = Promise.resolve();
	const database: Database = {
		execute: async (sql, params = []) => {
			const result = db.prepare(sql).run(bind(params) as never);
			return {
				rowsAffected: Number(result.changes),
				lastInsertId: Number(result.lastInsertRowid),
			};
		},
		select: async <Row>(sql: string, params: readonly unknown[] = []) =>
			db.prepare(sql).all(bind(params) as never) as unknown as Row[],
		transaction: async <T>(work: (db: Database) => Promise<T>): Promise<T> => {
			const run = async (): Promise<T> => {
				db.exec("BEGIN IMMEDIATE");
				try {
					const value = await work(database);
					db.exec("COMMIT");
					return value;
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			};
			const result = tail.then(run, run);
			tail = result.catch(() => undefined);
			return result;
		},
	};
	return database;
}

const harness: ContractHarness = {
	describe: (name, body) => {
		describe(name, body);
	},
	it: (name, body) => {
		it(name, body);
	},
	assert: (condition, message) => {
		expect(condition, message).toBe(true);
	},
};

let caseNumber = 0;

runPlatformContract(harness, "memory", async () => {
	caseNumber++;
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	const memory = createMemoryPlatform({
		clock: { now: () => 1_700_000_000_000 + caseNumber },
		ids: { uuid: () => `00000000-0000-4000-8000-${String(caseNumber).padStart(12, "0")}` },
		database: createDatabase(db),
		version: "0.0.0-test",
		channel: "dev",
		home: `/memory/${caseNumber}/home`,
		appData: `/memory/${caseNumber}/app-data`,
		temp: `/memory/${caseNumber}/temp`,
		resources: `/memory/${caseNumber}/resources`,
	});
	return {
		platform: memory.platform,
		controls: memory.controls,
		root: `/memory/${caseNumber}/root`,
		cleanup: async () => {
			memory.controls.dispose();
			db.close();
		},
	};
});

let nextId = 0;

function freshPlatform() {
	nextId++;
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	const memory = createMemoryPlatform({
		clock: { now: () => 42 },
		ids: { uuid: () => `uuid-${nextId}` },
		database: createDatabase(db),
	});
	return { memory, db };
}

describe("PLAT-01 in-memory Platform", () => {
	it("reports an unscripted shell command instead of inventing a result", async () => {
		const { db, memory } = freshPlatform();
		try {
			const result = await memory.platform.shell.run({
				program: "/bin/true",
				args: [],
				cwd: "/",
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("shell_unscripted");
		} finally {
			db.close();
		}
	});

	it("dispose throws while a listener is still attached", () => {
		const { db, memory } = freshPlatform();
		try {
			const unsubscribe = memory.platform.sidecar.onLine(() => {});
			expect(() => memory.controls.dispose()).toThrow(/listener/);
			unsubscribe();
			expect(() => memory.controls.dispose()).not.toThrow();
		} finally {
			db.close();
		}
	});

	it("takes time and ids from its options", async () => {
		const { db, memory } = freshPlatform();
		try {
			const write = await memory.platform.fs.writeTextAtomic("/work/file.txt", "x");
			expect(write.ok).toBe(true);
			const stat = await memory.platform.fs.stat("/work/file.txt");
			expect(stat.ok && stat.value.modifiedAt).toBe(42);
			const spawned = await memory.platform.pty.spawn({ cwd: "/", cols: 80, rows: 24 });
			expect(spawned.ok && spawned.value.id).toMatch(/^uuid-\d+$/);
		} finally {
			db.close();
		}
	});
});
