/**
 * @feature DATA-01 Helpers for reading and writing rows
 * Owns: the small pure functions every row mapper uses for JSON columns, 0/1 flags and lists of
 * results, and the three helpers that run a statement and turn an expected database failure into
 * an error Result instead of a throw.
 * Behaviour: migration 0001 conventions (JSON columns hold data checked by packages/protocol,
 * booleans are integers), and the repository rule that a unique clash is `db.conflict` while a
 * missing foreign row is `db.foreign_key`.
 * Must handle: text that is not JSON, JSON that fails its schema, values JSON cannot hold
 * (undefined, BigInt, cycles), a unique constraint, a foreign-key constraint. All of these come
 * back as an error Result.
 * Test first: parseJsonColumn on the text "{" returns an error with code db.invalid_json.
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { type ZodType, z } from "zod";
import type { Database } from "../../platform/platform.ts";

export const INVALID_JSON = "db.invalid_json";

/** Parses a JSON text column and checks it against a schema. `what` names the column in errors. */
export function parseJsonColumn<T>(raw: string, schema: ZodType<T>, what: string): Result<T> {
	const json = parseJsonText(raw, what);
	if (!json.ok) return json;
	const checked = schema.safeParse(json.value);
	if (!checked.success) {
		return err(appError(INVALID_JSON, `${what} does not match its schema`, checked.error));
	}
	return ok(checked.data);
}

/** Parses a JSON text column that has no fixed shape, such as a setting value. */
export function parseJsonText(raw: string, what: string): Result<unknown> {
	try {
		return ok(JSON.parse(raw) as unknown);
	} catch (cause) {
		return err(appError(INVALID_JSON, `${what} is not valid JSON`, cause));
	}
}

const zStringList = z.array(z.string());

/** A JSON column that holds a list of strings, such as workspaces.linked_paths. */
export function parseStringList(raw: string, what: string): Result<string[]> {
	return parseJsonColumn(raw, zStringList, what);
}

/** Turns a value into JSON text for a column, without throwing. */
export function stringifyJson(value: unknown, what: string): Result<string> {
	try {
		const text: string | undefined = JSON.stringify(value);
		if (text === undefined) return err(appError(INVALID_JSON, `${what} has no JSON form`));
		return ok(text);
	} catch (cause) {
		return err(appError(INVALID_JSON, `${what} cannot be written as JSON`, cause));
	}
}

/** Returns the values of a list of results, or the first error. */
export function collectResults<T, E = AppError>(results: readonly Result<T, E>[]): Result<T[], E> {
	const values: T[] = [];
	for (const result of results) {
		if (!result.ok) return result;
		values.push(result.value);
	}
	return ok(values);
}

export const toFlag = (value: boolean): 0 | 1 => (value ? 1 : 0);
export const fromFlag = (value: number): boolean => value !== 0;

const messageOf = (cause: unknown): string => {
	if (typeof cause === "string") return cause;
	if (cause instanceof Error) return cause.message;
	if (cause !== null && typeof cause === "object" && "message" in cause) {
		const message = (cause as { message: unknown }).message;
		if (typeof message === "string") return message;
	}
	return "";
};

/** Maps a thrown database error to the stable code services and screens depend on. */
export function databaseError(cause: unknown, what: string): AppError {
	const message = messageOf(cause);
	if (/UNIQUE constraint failed/i.test(message)) {
		return appError("db.conflict", `${what} conflicts with a row that already exists`, cause);
	}
	if (/FOREIGN KEY constraint failed/i.test(message)) {
		return appError("db.foreign_key", `${what} refers to a row that does not exist`, cause);
	}
	return appError("db.failed", `${what} failed`, cause);
}

/** Runs one SELECT statement. A thrown database error becomes an error Result. */
export async function selectRows<Row>(
	db: Database,
	sql: string,
	params: readonly unknown[],
	what: string,
): Promise<Result<Row[]>> {
	try {
		return ok(await db.select<Row>(sql, params));
	} catch (cause) {
		return err(databaseError(cause, what));
	}
}

/** Runs one INSERT, UPDATE or DELETE. Returns how many rows changed. */
export async function executeStatement(
	db: Database,
	sql: string,
	params: readonly unknown[],
	what: string,
): Promise<Result<number>> {
	try {
		const result = await db.execute(sql, params);
		return ok(result.rowsAffected);
	} catch (cause) {
		return err(databaseError(cause, what));
	}
}

/** Runs several statements in one transaction. The work returns its own Result. */
export async function inTransaction<T>(
	db: Database,
	what: string,
	work: (tx: Database) => Promise<Result<T>>,
): Promise<Result<T>> {
	try {
		return await db.transaction(async (tx) => {
			const result = await work(tx);
			if (!result.ok) throw new TransactionFailure(result.error);
			return result;
		});
	} catch (cause) {
		if (cause instanceof TransactionFailure) return err(cause.error);
		return err(databaseError(cause, what));
	}
}

/** Thrown only inside `inTransaction`, so the database rolls back before the error is returned. */
class TransactionFailure extends Error {
	readonly error: AppError;

	constructor(error: AppError) {
		super(error.message);
		this.error = error;
	}
}
