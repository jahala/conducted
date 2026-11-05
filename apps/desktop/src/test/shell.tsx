/**
 * @feature NAV-01 Shell test rendering
 * Owns: mounting the real app shell over a container, with a one-line centre route, so a test can read what the
 * shell does without loading every screen.
 * Behaviour: not applicable, test support only.
 * Must handle: the settings are loaded first, because the shell draws nothing before they are; the caller
 * removes the mounted shell with Testing Library's `cleanup`.
 * Test first: covered by ui/layout-sizes.test.ts, which mounts the shell through it.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { AppShell } from "../app/AppShell.tsx";
import { AppProviders, createQueryClient } from "../app/providers.tsx";
import type { Container } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";

/** Text the centre route shows, for a test to wait on. */
export const CENTRE_ROUTE_TEXT = "centre route";

/** Loads the settings, mounts the shell and waits for its centre route. */
export async function mountShell(container: Container): Promise<void> {
	await container.services.settings.start();
	const rootRoute = createRootRoute({ component: AppShell });
	const centre = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <p>{CENTRE_ROUTE_TEXT}</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([centre]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	await screen.findByText(CENTRE_ROUTE_TEXT);
}
