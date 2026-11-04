/**
 * Failure lives in the return type. Functions that can fail for expected reasons
 * (git refused, file missing, agent not installed) return a Result instead of throwing.
 * Throwing is kept for programmer errors and for `notImplemented`.
 */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** An expected failure, shown to the user or logged. `code` is stable; `message` is plain language. */
export interface AppError {
	readonly code: string;
	readonly message: string;
	readonly cause?: unknown;
}

export const appError = (code: string, message: string, cause?: unknown): AppError =>
	cause === undefined ? { code, message } : { code, message, cause };
