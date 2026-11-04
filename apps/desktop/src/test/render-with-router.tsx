/**
 * @feature NAV-02 Router test helper
 * Owns: rendering a component inside a real router with an in-memory history, so components that use links
 * and router hooks can be tested.
 * Behaviour: not applicable, test support only.
 * Must handle: the router resolves asynchronously, so callers wait for text with findBy queries.
 * Test first: not applicable.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import "./dom-polyfills.ts";

export function renderWithRouter(ui: ReactNode, path = "/") {
	const rootRoute = createRootRoute();
	const route = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => ui });
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	return render(<RouterProvider router={router} />);
}
