/**
 * @feature DATA-01 Helpers for reading and writing row columns
 * Owns: the small pure functions every row mapper uses for JSON columns, 0/1 flags and lists of
 * results, so no mapper repeats them and none of them throws.
 * Behaviour: migration 0001 conventions (JSON columns hold data checked by packages/protocol,
 * booleans are integers).
 * Must handle: text that is not JSON, JSON that fails its schema, values JSON cannot hold
 * (undefined, BigInt, cycles). All of these come back as an error Result.
 * Test first: parseJsonColumn on the text "{" returns an error with code db.invalid_json.
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { type ZodType, z } from "zod";

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
