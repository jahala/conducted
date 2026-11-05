/**
 * @feature DATA-01 Query client defaults and shared query options
 * Owns: the one query client default set and the shared option presets that queries spread in.
 * Behaviour: services-map.md 2.5.1 (client defaults: no retry, data never stale on its own, 5 min
 * gc; shared preset `Aa`: at most two retries on non-4xx errors and a 30 s stale time; per-query
 * overrides such as Infinity for app icons and port discovery), 2.5.2 (query keys and what
 * invalidates them live with the first query).
 * Must handle: an error with no HTTP status is retried; a 4xx status is not; the retry count
 * stops at two; no persister is attached, so the cache lives in memory for the app's lifetime.
 * Our design choice: our queries are for git, GitHub and files; SQL data stays in service stores,
 * so the client defaults match Conductor's and the shared preset is used only where a source
 * refreshes itself.
 * Test first: the shared preset retries a network error twice and stops retrying at once on a
 * 404.
 */

/** How many times the shared preset retries a query that can still succeed. */
export const QUERY_RETRY_LIMIT = 2;

/** A query whose answer only changes when the app asks again (app icons, port discovery). */
export const QUERY_STALE_FOREVER_MS = Number.POSITIVE_INFINITY;

/** How long an unused query result stays in memory. The library default is five minutes. */
export const QUERY_GC_TIME_MS = 5 * 60_000;

/** The shared stale time for a source that changes on its own, such as settings or ports. */
export const SHARED_STALE_TIME_MS = 30_000;

interface Statusful {
	status?: unknown;
	response?: { status?: unknown } | null;
}

/** Whether an error is a client error (HTTP 4xx), which retrying cannot fix. */
export function isClientError(error: unknown): boolean {
	if (error === null || typeof error !== "object") return false;
	const candidate = error as Statusful;
	const status =
		typeof candidate.status === "number" ? candidate.status : candidate.response?.status;
	return typeof status === "number" && status >= 400 && status < 500;
}

/** Defaults for the whole query client. SQL data does not flow through it. */
export const queryClientDefaults = {
	networkMode: "always",
	retry: false,
	refetchOnWindowFocus: false,
	staleTime: QUERY_STALE_FOREVER_MS,
	gcTime: QUERY_GC_TIME_MS,
} as const;

/**
 * Spread into queries whose source refreshes itself: at most two retries, and never after a
 * 4xx answer.
 */
export const sharedQueryOptions = {
	retry: (failureCount: number, error: unknown): boolean =>
		failureCount < QUERY_RETRY_LIMIT && !isClientError(error),
	staleTime: SHARED_STALE_TIME_MS,
} as const;

/** Spread into a query that must never be collected while the app runs. */
export const immutableQueryOptions = {
	staleTime: QUERY_STALE_FOREVER_MS,
	gcTime: QUERY_STALE_FOREVER_MS,
} as const;
