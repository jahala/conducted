/**
 * @feature s1-ui-2 Join the batch's features through the composition root
 * Owns: one test per feature in the batch: REV-06 file tree, REV-07 quick open and search in files,
 * SET-02 settings pages and search, SET-06 appearance, and WS-08 open in another app. Each test
 * reaches the feature through createTestContainer and the real screen, dialog or route the app
 * mounts.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container or screen wiring is removed.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { CommandDispatcher } from "../app/command-dispatcher.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { GlobalOverlays } from "../app/GlobalOverlays.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { useOverlayStore } from "../app/overlay-store.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { createAppRouter } from "../app/router.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { GitPanel } from "../features/git-panel/GitPanel.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { WorkspaceHeader } from "../features/workspace/WorkspaceHeader.tsx";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import type { ChangesSnapshot } from "./git/status.ts";

const h = createElement;

type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;

const Services = ServicesProvider as unknown as LooseComponent;
const App = AppProviders as unknown as LooseComponent;

const snapshot = (): ChangesSnapshot => ({
	depth: "full",
	branch: "join",
	mergeBase: "abc123",
	mergeBaseError: null,
	files: [],
	conflictedPaths: [],
	untrackedTruncated: false,
	uncommittedFiles: 0,
	changedFiles: 0,
	operation: "none",
	commits: [],
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
	behindTarget: 0,
});

function renderInside(container: Container, node: ReactNode) {
	const client = createQueryClient(() => {});
	return render(h(Services, { container }, h(App, { client }, node)));
}

function clearAppearance() {
	for (const name of ["data-theme", "data-contrast", "data-color-vision", "data-vibrancy"]) {
		document.documentElement.removeAttribute(name);
	}
	document.documentElement.style.removeProperty("zoom");
	useOverlayStore.getState().close();
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	clearAppearance();
});

describe("s1-ui-2 join", () => {
	it("REV-06 lists the workspace's files in the Git panel's All files tab", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/join/rev-06" });
			test.memory.controls.files.set(`${workspace.path}/src/app.ts`, "");
			test.memory.controls.files.set(`${workspace.path}/README.md`, "");
			test.container.services.git.store.setState({
				byWorkspace: {
					[workspace.id]: { snapshot: snapshot(), error: null, refreshedAt: 1 },
				},
			});
			test.container.services.github.store.setState({
				byWorkspace: {
					[workspace.id]: { pullRequest: null, unavailable: "none", fetchedAt: 1 },
				},
			});

			renderInside(
				test.container,
				h(CommandDispatcher, null, h(GitPanel, { workspaceId: workspace.id })),
			);

			const allFiles = await screen.findByRole("tab", { name: "All files" });
			fireEvent.mouseDown(allFiles, { button: 0 });

			expect(await screen.findByText("README.md")).toBeTruthy();
			expect(await screen.findByRole("button", { name: "Expand src" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("REV-07 opens quick open and search in files from the root shortcuts", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/join/rev-07" });
			test.memory.controls.files.set(`${workspace.path}/src/app/AppShell.tsx`, "export {};\n");
			test.memory.controls.files.set(`${workspace.path}/src/retry.ts`, "retry now\n");

			const rootRoute = createRootRoute();
			const route = createRoute({
				getParentRoute: () => rootRoute,
				path: "/repository/$repositoryId/workspace/$workspaceId",
				component: () => h(CommandDispatcher, null, h(GlobalOverlays)),
			});
			const router = createRouter({
				routeTree: rootRoute.addChildren([route]),
				history: createMemoryHistory({
					initialEntries: [`/repository/r1/workspace/${workspace.id}`],
				}),
			});
			renderInside(test.container, h(RouterProvider, { router }));
			await router.load();

			fireEvent.keyDown(document.body, { key: "p", metaKey: true });
			const quickOpen = await screen.findByRole("textbox", { name: "Search files by name" });
			fireEvent.change(quickOpen, { target: { value: "appshell" } });
			expect(await screen.findByRole("button", { name: "src/app/AppShell.tsx" })).toBeTruthy();

			useOverlayStore.getState().close();
			await waitFor(() =>
				expect(screen.queryByRole("textbox", { name: "Search files by name" })).toBeNull(),
			);

			fireEvent.keyDown(document.body, { key: "f", metaKey: true, shiftKey: true });
			const search = await screen.findByRole("searchbox", { name: "Search file contents" });
			fireEvent.change(search, { target: { value: "retry" } });
			expect(await screen.findByRole("region", { name: "src/retry.ts" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-02 finds a settings page from the settings search and opens it", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const router = createAppRouter(
				createMemoryHistory({ initialEntries: ["/settings/general"] }),
			);
			renderInside(test.container, h(RouterProvider, { router }));
			await router.load();

			await screen.findByRole("navigation", { name: "Settings" });
			const settingsScreen = await screen.findByTestId("settings-screen");
			fireEvent.keyDown(settingsScreen, { key: "f", metaKey: true });
			const search = await screen.findByRole("searchbox", { name: "Search settings" });
			expect(document.activeElement).toBe(search);

			fireEvent.change(search, { target: { value: "zoom" } });
			fireEvent.click(await screen.findByRole("button", { name: /App zoom/ }));

			await waitFor(() => expect(router.state.location.pathname).toBe("/settings/appearance"));
			expect(await screen.findByRole("heading", { name: "Appearance" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-06 applies the appearance shortcut on the mounted Appearance page", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const router = createAppRouter(
				createMemoryHistory({ initialEntries: ["/settings/appearance"] }),
			);
			renderInside(test.container, h(RouterProvider, { router }));
			await router.load();
			await screen.findByRole("heading", { name: "Appearance" });

			fireEvent.keyDown(document, { key: "t", metaKey: true, altKey: true });

			await waitFor(() =>
				expect(test.container.services.settings.store.getState().values.theme).toBe("dark"),
			);
			await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-08 opens the workspace in the header's Open in app", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/join/ws-08" });
			const openIn = vi
				.spyOn(test.container.services.workspace, "openIn")
				.mockResolvedValue(ok(undefined));

			renderInside(
				test.container,
				h(
					CommandDispatcher,
					null,
					h(WorkspaceHeader, {
						repoId: workspace.repoId,
						workspaceId: workspace.id as WorkspaceId,
						controls: { rightPanelOpen: true, toggleRightPanel: vi.fn() },
					}),
				),
			);

			const openButton = await screen.findByRole("button", { name: /^Finder$/ });
			fireEvent.click(openButton);

			await waitFor(() => expect(openIn).toHaveBeenCalledWith(workspace.id, "Finder"));
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
