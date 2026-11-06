/**
 * @feature APP-06 Update status hook
 * Owns: tests that the update notice hook reads the updates service's store.
 * Behaviour: services-map.md 5B.4.1; core/hooks.ts states the hook contract.
 * Test first: the hook shows the status the service stores and follows a later change.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useUpdateStatus } from "./hooks.ts";

let open: TestContainer | null = null;

afterEach(() => {
	open?.close();
	open = null;
});

function wrapper(container: ReturnType<typeof createTestContainer>["container"]) {
	return ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container}>{children}</ServicesProvider>
	);
}

describe("APP-06 useUpdateStatus", () => {
	it("shows the status the updates service holds and follows a change", () => {
		const test = createTestContainer();
		open = test;
		const { result } = renderHook(() => useUpdateStatus(), {
			wrapper: wrapper(test.container),
		});
		expect(result.current).toEqual({
			state: "idle",
			version: null,
			notesUrl: null,
			error: null,
		});

		act(() => {
			test.container.services.updates.store.setState({
				state: "available",
				version: "0.2.0",
				notesUrl: null,
				error: null,
			});
		});

		expect(result.current).toMatchObject({ state: "available", version: "0.2.0" });
	});
});
