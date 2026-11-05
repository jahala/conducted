/**
 * @feature PLAT-02 The statement queue behind Platform.db
 * Owns: turning a raw SQL handle (tauri-plugin-sql in the app, node:sqlite in tests) into the
 * `Database` the app uses: one queue for every statement, a transaction that holds the queue from
 * BEGIN IMMEDIATE to COMMIT or ROLLBACK, merged identical selects, a handle that stops working
 * when its transaction ends, and a log line for slow statements. `createTauriDatabase` and the
 * test database both call `createQueuedDatabase`, so a test runs the queue the app runs.
 * Behaviour: services-map.md 1.1 (Conductor's Platform object); our own design for the queue.
 * Must handle: a statement made on the outer database while a transaction is open waits for the
 * transaction. A function that does so from inside the transaction's own work waits for itself and
 * never finishes; the work has to use the handle it was given. The queue cannot tell the two
 * callers apart, so it cannot fail fast, and the test database shows the same hang. Two
 * overlapping transactions run one after the other. The pragmas the connection needs are in
 * `DATABASE_PRAGMAS`.
 * Test first: a transaction started while another is open does not begin until the first commits.
 */
import { appError } from "@conducted/shared";
import type { Database, SqlResult } from "./platform.ts";

/** The database handle tauri-plugin-sql returns. Only the calls the Platform needs. */
export interface SqlDatabase {
	execute(
		query: string,
		bindValues?: unknown[],
	): Promise<{ rowsAffected: number; lastInsertId?: number }>;
	select<Rows>(query: string, bindValues?: unknown[]): Promise<Rows>;
}

export interface QueuedDatabaseOptions {
	/** A statement at or above this many milliseconds is logged. Defaults to 1000. */
	slowMs?: number;
	/** Where slow statements go. The Platform passes `app.writeLog`. */
	log?: (level: "warn", message: string, data: unknown) => void;
}

/** Run on a fresh connection before the first statement. */
export const DATABASE_PRAGMAS: readonly string[] = [
	"PRAGMA journal_mode = WAL",
	"PRAGMA foreign_keys = ON",
];

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Wraps a raw handle. Every statement goes through one queue, so the plugin's pool never runs two
 * at once. A transaction holds the queue from BEGIN IMMEDIATE to COMMIT or ROLLBACK; the work it
 * runs gets a handle that skips the queue, because the queue is already held. Identical
 * concurrent `select` calls share one promise, and a write clears those in-flight entries so a
 * later read cannot get a pre-write result.
 */
export function createQueuedDatabase(
	raw: SqlDatabase,
	options: QueuedDatabaseOptions = {},
): Database {
	const slowMs = options.slowMs ?? 1_000;
	const log = options.log ?? (() => {});
	const logIfSlow = (sql: string, startedAt: number): void => {
		const elapsedMs = nowMs() - startedAt;
		if (elapsedMs >= slowMs) {
			log("warn", "Slow SQLite call", { sql, elapsedMs });
		}
	};
	const write = async (sql: string, params?: readonly unknown[]): Promise<SqlResult> => {
		const startedAt = nowMs();
		try {
			return await raw.execute(sql, params === undefined ? undefined : [...params]);
		} finally {
			logIfSlow(sql, startedAt);
		}
	};
	const read = async <Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> => {
		const startedAt = nowMs();
		try {
			return (await raw.select<Row[]>(
				sql,
				params === undefined ? undefined : [...params],
			)) as Row[];
		} finally {
			logIfSlow(sql, startedAt);
		}
	};

	const pendingSelects = new Map<string, Promise<unknown[]>>();
	const clearPendingSelects = (): void => {
		pendingSelects.clear();
	};

	/** Runs one statement at a time, in call order, and keeps the queue alive after a failure. */
	let queue: Promise<unknown> = Promise.resolve();
	const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
		const run = queue.then(task);
		queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};

	const writeOutsideTransaction = (
		sql: string,
		params?: readonly unknown[],
	): Promise<SqlResult> => {
		clearPendingSelects();
		return enqueue(() => write(sql, params));
	};

	return {
		execute: writeOutsideTransaction,
		select: <Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> => {
			const key = `${sql}\u0000${JSON.stringify(params ?? [])}`;
			const existing = pendingSelects.get(key);
			if (existing !== undefined) return existing as Promise<Row[]>;
			const promise = enqueue(() => read<Row>(sql, params));
			pendingSelects.set(key, promise as Promise<unknown[]>);
			const settle = (): void => {
				// A write may have cleared this entry and a newer read taken its place.
				if (pendingSelects.get(key) === promise) pendingSelects.delete(key);
			};
			void promise.then(settle, settle);
			return promise;
		},
		transaction: <T>(work: (db: Database) => Promise<T>): Promise<T> => {
			// A read asked for after this point must not join a select from before it.
			clearPendingSelects();
			return enqueue(async () => {
				// The work's own statements run one at a time on a queue local to this
				// transaction, so even a `Promise.all` inside it keeps one connection.
				let transactionQueue: Promise<unknown> = Promise.resolve();
				const transactionRun = <U>(task: () => Promise<U>): Promise<U> => {
					const run = transactionQueue.then(task);
					transactionQueue = run.then(
						() => undefined,
						() => undefined,
					);
					return run;
				};
				// The handle given to `work` stops working when the transaction ends, so a statement
				// kept past COMMIT cannot run outside the queue.
				let open = true;
				const whileOpen = <U>(task: () => Promise<U>): Promise<U> =>
					open
						? transactionRun(task)
						: Promise.reject(
								appError(
									"transaction_closed",
									"This transaction has ended. Run the statement on the Database instead.",
								),
							);
				const transactionDatabase: Database = {
					execute: (sql, params) => whileOpen(() => write(sql, params)),
					select: <Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> =>
						whileOpen(() => read<Row>(sql, params)),
					transaction: () =>
						Promise.reject(
							appError(
								"transaction_nested",
								"Database.transaction cannot start inside another transaction.",
							),
						),
				};

				await transactionRun(() => write("BEGIN IMMEDIATE"));
				try {
					const value = await work(transactionDatabase);
					await transactionRun(() => write("COMMIT"));
					return value;
				} catch (error) {
					try {
						await transactionRun(() => write("ROLLBACK"));
					} catch {
						// The failure that caused the rollback is the one the caller needs.
					}
					throw error;
				} finally {
					open = false;
					clearPendingSelects();
				}
			});
		},
	};
}
