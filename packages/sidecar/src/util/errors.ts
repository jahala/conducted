/**
 * @feature SIDE-01 Entry point and modes: error helpers
 * Owns: one spelling for the message of a thrown value, the check that a value is an AppError, and
 * the wrap of a thrown value into one, and the check for a missing file.
 * Behaviour: `Result` carries expected failures (docs/engineering.md), so this module only reads
 * values that reached a catch or an error callback.
 * Must handle: an Error, a thrown AppError (a plain object: its message, never "[object Object]"),
 * any other thrown value, and a plain object that only looks like an AppError (a code and a
 * message, both strings).
 * Test first: messageOf(new Error("boom")) is "boom" and isAppError({ code, message }) is true.
 * Our design choice: the helpers live in one file because four modules had their own copy, and the
 * copies could drift.
 */
import type { AppError } from "@conducted/shared";
import { appError } from "@conducted/shared";

/** The message of a thrown value, in one spelling for every module. */
export function messageOf(cause: unknown): string {
	if (cause instanceof Error) return cause.message;
	if (isAppError(cause)) return cause.message;
	return String(cause);
}

/** True when the value carries the two fields every AppError has. */
export function isAppError(value: unknown): value is AppError {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { code?: unknown; message?: unknown };
	return typeof candidate.code === "string" && typeof candidate.message === "string";
}

/** Keeps an AppError as it is. Wraps anything else under `code`, with `message` and the cause. */
export function asAppError(code: string, message: string, cause: unknown): AppError {
	if (isAppError(cause)) return cause;
	return appError(code, `${message}: ${messageOf(cause)}`, cause);
}

/** True when a file system call failed because the file or folder does not exist. */
export function isMissingFile(cause: unknown): boolean {
	return (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		(cause as { code?: string }).code === "ENOENT"
	);
}
