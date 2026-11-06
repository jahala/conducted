/**
 * @feature test support A real database that holds one chosen write until the test lets it go
 * Owns: `holdingOnExecute`, which wraps a real `Database` so that each call of one SQL statement
 * waits until the test releases it, and every other call goes to the real database at once.
 * Behaviour: a held statement runs on the real database when it is released, in release order, so
 * a test can make one write's answer arrive while another write is still on its way.
 * Must handle: several held calls (released one at a time, oldest first); a transaction's work
 * gets the transaction's own handle, wrapped the same way; a release with nothing held is a test
 * error and throws.
 * Test first: not applicable; the dashboard's two quick moves (NAV-06) use it.
 */
import type { Database } from "../platform/platform.ts";

export interface HeldDatabase {
	database: Database;
	/** How many calls of the statement are waiting. */
	held(): number;
	/** Runs the oldest waiting call on the real database and settles it with its answer. */
	releaseNext(): Promise<void>;
}

export function holdingOnExecute(inner: Database, heldSql: string): HeldDatabase {
	const waiting: (() => Promise<void>)[] = [];
	const wrap = (db: Database): Database => ({
		execute: (sql, params) => {
			if (sql !== heldSql) return db.execute(sql, params);
			return new Promise((resolve, reject) => {
				waiting.push(() => db.execute(sql, params).then(resolve, reject));
			});
		},
		select: <Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> =>
			db.select<Row>(sql, params),
		transaction: <T>(work: (tx: Database) => Promise<T>): Promise<T> =>
			db.transaction((tx) => work(wrap(tx))),
	});
	return {
		database: wrap(inner),
		held: () => waiting.length,
		releaseNext: async () => {
			const next = waiting.shift();
			if (next === undefined) throw new Error(`No call of ${heldSql} is held`);
			await next();
		},
	};
}
