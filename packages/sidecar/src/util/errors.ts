/**
 * @feature SIDE-01 Entry point and modes: error helpers
 * Owns: one spelling for the message of a thrown value, and the check that a value is an AppError.
 * Behaviour: `Result` carries expected failures (docs/engineering.md), so this module only reads
 * values that reached a catch or an error callback.
 * Must handle: an Error, any other thrown value, and a plain object that only looks like an
 * AppError (a code and a message, both strings).
 * Test first: messageOf(new Error("boom")) is "boom" and isAppError({ code, message }) is true.
 * Our design choice: the helpers live in one file because four modules had their own copy, and the
 * copies could drift.
 */
import type { AppError } from "@conducted/shared";

/** The message of a thrown value, in one spelling for every module. */
export function messageOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/** True when the value carries the two fields every AppError has. */
export function isAppError(value: unknown): value is AppError {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { code?: unknown; message?: unknown };
	return typeof candidate.code === "string" && typeof candidate.message === "string";
}
