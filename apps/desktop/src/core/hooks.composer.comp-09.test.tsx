/**
 * @feature COMP-09 Prompt snippets
 * Owns: tests over the real container that useSnippets loads the saved list once, reports its
 * loading and ready states, and follows a create and a delete.
 * Behaviour: ui-map.md 5.1 (the snippet picker loads its list once).
 * Test first: useSnippets starts loading, then returns the snippets the container's repository
 * holds.
 */
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useSnippets } from "./hooks.ts";

const must = <T,>(
	result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

const containers: TestContainer[] = [];

afterEach(() => {
	for (const test of containers.splice(0)) test.close();
});

function wrapper(test: TestContainer) {
	return ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
}

describe("COMP-09 useSnippets", () => {
	it("loads the saved snippets and follows a create and a delete", async () => {
		const test = createTestContainer();
		containers.push(test);
		const { result } = renderHook(() => useSnippets(), { wrapper: wrapper(test) });

		expect(result.current.state).toBe("loading");
		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current).toEqual({ state: "ready", data: [] });

		const created = must(
			await test.container.actions.snippets.create({
				name: "Review",
				keyword: "rev",
				prompt: "Review this change.",
			}),
		);
		await waitFor(() => expect(result.current).toEqual({ state: "ready", data: [created] }));

		must(await test.container.actions.snippets.remove(created.id));
		await waitFor(() => expect(result.current).toEqual({ state: "ready", data: [] }));
	});
});
