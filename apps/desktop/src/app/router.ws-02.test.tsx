/**
 * @feature WS-02 Create from a branch, PR or issue
 * Owns: Cmd+Shift+N opening the new-workspace page through the root shortcut dispatcher.
 * Behaviour: ui-map.md 5.4 (create workspace from a PR, branch or issue).
 * Test first: pressing Cmd+Shift+N at the app root opens /create.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { createAppRouter } from "./router.tsx";

let test: TestContainer | null = null;
let client: QueryClient | null = null;

afterEach(() => {
	cleanup();
	client?.clear();
	client = null;
	test?.close();
	test = null;
});

describe("WS-02 Cmd+Shift+N", () => {
	it("opens the new-workspace page from the root dispatcher", async () => {
		test = createTestContainer();
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
		render(
			<QueryClientProvider client={client}>
				<ServicesProvider container={test.container}>
					<RouterProvider router={router} />
				</ServicesProvider>
			</QueryClientProvider>,
		);
		await router.load();

		fireEvent.keyDown(document.body, {
			key: "N",
			metaKey: true,
			shiftKey: true,
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/create"));
	});
});
