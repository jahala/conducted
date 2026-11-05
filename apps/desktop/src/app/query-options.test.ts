/**
 * @feature DATA-01 Query client defaults and shared query options
 * Owns: proving the client defaults, the shared retry and stale-time preset, and that the cache
 * lives in memory only.
 * Behaviour: services-map.md 2.5.1 (client defaults and shared preset), 2.5.2 (no persisted
 * query cache).
 * Test first: the shared preset retries a network error twice and stops retrying at once on a
 * 404.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	isClientError,
	QUERY_GC_TIME_MS,
	queryClientDefaults,
	SHARED_STALE_TIME_MS,
	sharedQueryOptions,
} from "./query-options.ts";

const retry = sharedQueryOptions.retry;

describe("DATA-01 query client defaults", () => {
	it("keeps data fresh only when the app asks, and holds it for five minutes", () => {
		expect(queryClientDefaults.retry).toBe(false);
		expect(queryClientDefaults.staleTime).toBe(Number.POSITIVE_INFINITY);
		expect(queryClientDefaults.gcTime).toBe(QUERY_GC_TIME_MS);
		expect(QUERY_GC_TIME_MS).toBe(300_000);
	});

	it("retries a network error twice, then stops", () => {
		expect(retry(0, new Error("offline"))).toBe(true);
		expect(retry(1, new Error("offline"))).toBe(true);
		expect(retry(2, new Error("offline"))).toBe(false);
	});

	it("never retries a 4xx answer, in either error shape", () => {
		expect(retry(0, { status: 404 })).toBe(false);
		expect(retry(0, { status: 422 })).toBe(false);
		expect(retry(0, { response: { status: 401 } })).toBe(false);
		expect(retry(0, { status: 500 })).toBe(true);
		expect(isClientError({ status: 499 })).toBe(true);
		expect(isClientError({ status: 500 })).toBe(false);
	});

	it("uses a 30 second stale time for sources that change on their own", () => {
		expect(sharedQueryOptions.staleTime).toBe(SHARED_STALE_TIME_MS);
		expect(SHARED_STALE_TIME_MS).toBe(30_000);
	});

	it("keeps the query cache in memory, not in storage", () => {
		const first = new QueryClient({ defaultOptions: { queries: queryClientDefaults } });
		const second = new QueryClient({ defaultOptions: { queries: queryClientDefaults } });
		first.setQueryData(["probe"], { value: 1 });
		expect(second.getQueryData(["probe"])).toBeUndefined();
		expect(queryClientDefaults.gcTime).not.toBe(Number.POSITIVE_INFINITY);
		first.clear();
		second.clear();
	});
});
