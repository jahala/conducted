/**
 * @feature DATA-01 React context that carries the container
 * Behaviour: services-map.md 1.1; core/context.tsx.
 * Test first: useServices outside a provider throws an error that names ServicesProvider.
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../test/container.ts";
import { ServicesProvider, useServices } from "./context.tsx";

describe("useServices", () => {
	it("throws a message that names the provider when used outside it", () => {
		expect(() => renderHook(() => useServices())).toThrow(/ServicesProvider/);
	});

	it("returns the very container the provider was given, across re-renders", () => {
		const test = createTestContainer();
		try {
			const { result, rerender } = renderHook(() => useServices(), {
				wrapper: ({ children }: { children: ReactNode }) => (
					<ServicesProvider container={test.container}>{children}</ServicesProvider>
				),
			});
			const first = result.current;
			rerender();

			expect(first).toBe(test.container);
			expect(result.current).toBe(test.container);
		} finally {
			test.close();
		}
	});
});
