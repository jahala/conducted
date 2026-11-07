/**
 * @feature REV-07 Quick open and search in files
 * Owns: tests that the Cmd+P and Cmd+Shift+F shortcuts reach the two dialogs through the root
 * dispatcher and the real overlay host.
 * Behaviour: ui-map.md 5.4 (Cmd+P quick open file, Cmd+Shift+F search in files).
 * Test first: pressing Cmd+P on a workspace route opens Quick open.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { GlobalOverlays } from "../../app/GlobalOverlays.tsx";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

afterEach(cleanup);
beforeEach(() => useOverlayStore.getState().close());

async function mountWorkspaceApp() {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/shortcut" });
	test.memory.controls.files.set(`${workspace.path}/src/app/AppShell.tsx`, "export {};\n");
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => (
			<CommandDispatcher>
				<GlobalOverlays />
			</CommandDispatcher>
		),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({
			initialEntries: [`/repository/r1/workspace/${workspace.id}`],
		}),
	});
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return test;
}

describe("REV-07 shortcuts", () => {
	it("opens Quick open with Cmd+P", async () => {
		const test = await mountWorkspaceApp();
		try {
			fireEvent.keyDown(document, { key: "p", metaKey: true });
			expect(await screen.findByRole("textbox", { name: "Search files by name" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("opens Search in files with Cmd+Shift+F", async () => {
		const test = await mountWorkspaceApp();
		try {
			fireEvent.keyDown(document, { key: "f", metaKey: true, shiftKey: true });
			expect(await screen.findByRole("searchbox", { name: "Search file contents" })).toBeTruthy();
		} finally {
			test.close();
		}
	});
});
