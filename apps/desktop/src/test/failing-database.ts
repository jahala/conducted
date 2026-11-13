/**
 * @feature test support A real database that fails one chosen query
 * Owns: `failingOnSelect` and `failingOnExecute`, which wrap a real `Database` so that one SQL
 * select or write rejects with the given error, outside a transaction and inside it, and every
 * other call goes to the real database. A select can fail only while the test says so.
 * Behaviour: the wrapped database is the real one (openTestDatabase or the app's queued wrapper), so
 * the only difference a test sees is the one failure it asked for.
 * Contract test: ../core/db/repair.test.ts
 * Must handle: a transaction's work gets the transaction's own handle, wrapped the same way, never
 * the outer database. With the app's statement queue, a call to the outer database inside a
 * transaction waits for that transaction to end, so it would never return.
 */
import type { Database } from "../platform/platform.ts";

/** The real database, except that one select rejects with `error` while `failing()` says so. */
export function failingOnSelect(
	inner: Database,
	failingSql: string,
	error: Error,
	failing: () => boolean = () => true,
): Database {
	return {
		execute: (sql, params) => inner.execute(sql, params),
		select: <Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> =>
			sql === failingSql && failing() ? Promise.reject(error) : inner.select<Row>(sql, params),
		transaction: <T>(work: (db: Database) => Promise<T>): Promise<T> =>
			inner.transaction((tx) => work(failingOnSelect(tx, failingSql, error, failing))),
	};
}

/** The real database, except that one write statement rejects with `error`. */
export function failingOnExecute(inner: Database, failingSql: string, error: Error): Database {
	return {
		execute: (sql, params) =>
			sql === failingSql ? Promise.reject(error) : inner.execute(sql, params),
		select: <Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> =>
			inner.select<Row>(sql, params),
		transaction: <T>(work: (db: Database) => Promise<T>): Promise<T> =>
			inner.transaction((tx) => work(failingOnExecute(tx, failingSql, error))),
	};
}
