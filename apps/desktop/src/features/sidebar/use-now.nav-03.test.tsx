/**
 * @feature NAV-03 Current time for the sidebar
 * Owns: tests that the sidebar clock moves forward once a minute and leaves no timer behind.
 * Test first: after 60 seconds the hook returns the new time; after unmount no timer is left.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MINUTE_MS, useNow } from "./use-now.ts";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("NAV-03 useNow", () => {
	it("moves forward each minute", () => {
		vi.useFakeTimers();
		let time = 1_000;
		const read = () => time;
		const { result } = renderHook(() => useNow(read));
		expect(result.current).toBe(1_000);
		time = 1_000 + MINUTE_MS;
		act(() => {
			vi.advanceTimersByTime(MINUTE_MS);
		});
		expect(result.current).toBe(1_000 + MINUTE_MS);
	});

	it("clears its timer when the list goes away", () => {
		vi.useFakeTimers();
		const { unmount } = renderHook(() => useNow(() => 5));
		expect(vi.getTimerCount()).toBe(1);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
