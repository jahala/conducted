/**
 * @feature AGENT-09 Cursor: SDK in process: reading loose records
 * Owns: one spelling for reading an agent's untyped JSON: is this value an object, the value as an
 * object, and a string field of it.
 * Behaviour: agents send JSON whose shape we check field by field (other-runners.md section 3), so
 * every translator and protocol reader needs the same three checks.
 * Must handle: null, arrays (never a record), and a record that is missing (a string read gives
 * null).
 * Test first: asRecord([]) is null and readString({ a: 1 }, "a") is null.
 * Our design choice: the helpers live in one file because the Cursor, Codex and ACP runners each
 * had their own copy, and the copies had already drifted (some took arrays as records).
 */

/** True for an object value that is not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value as a record, or null when it is not one. */
export function asRecord(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

/** A string field of a record. Null when the record is missing or the field is not a string. */
export function readString(
	record: Record<string, unknown> | null | undefined,
	key: string,
): string | null {
	const value = record?.[key];
	return typeof value === "string" ? value : null;
}
