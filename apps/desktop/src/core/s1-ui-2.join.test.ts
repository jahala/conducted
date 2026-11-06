/**
 * @feature s1-ui-2 Join the batch's features through the composition root
 * Owns: one test per feature in the batch: REV-06 file tree, REV-07 quick open and search in files,
 * SET-02 settings pages and search, SET-06 appearance, and WS-08 open in another app. Each test
 * builds the real container with createTestContainer, mounts the app's own route tree
 * (createAppRouter, with its root layout, dispatcher and overlays), and drives the feature with the
 * keys and clicks a user would use.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container, route or root wiring is removed.
 */
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { useOverlayStore } from "../app/overlay-store.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { createAppRouter } from "../app/router.tsx";
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

/** Mounts the app's own route tree at `path`, as main.tsx does. */
async function openApp(container: Container, path: string) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	renderInside(container, h(RouterProvider, { router }));
	await router.load();
	return router;
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
	window.localStorage.clear();
});

describe("s1-ui-2 join", () => {
	it("REV-06 lists the workspace's files in the Git panel's All files tab", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
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

			const router = await openApp(
				test.container,
				`/repository/${workspace.repoId}/workspace/${workspace.id}`,
			);

			const allFiles = await screen.findByRole("tab", { name: "All files" });
			fireEvent.mouseDown(allFiles, { button: 0 });

			expect(await screen.findByText("README.md")).toBeTruthy();
			expect(await screen.findByRole("button", { name: "Expand src" })).toBeTruthy();

			fireEvent.doubleClick(screen.getByText("README.md"));

			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					tab: "file",
					path: "README.md",
					fileMode: "edit",
				}),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("REV-07 opens quick open and search in files from the root shortcuts", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/rev-07" });
			test.memory.controls.files.set(`${workspace.path}/src/app/AppShell.tsx`, "export {};\n");
			test.memory.controls.files.set(`${workspace.path}/src/retry.ts`, "retry now\n");

			const router = await openApp(
				test.container,
				`/repository/${workspace.repoId}/workspace/${workspace.id}`,
			);

			fireEvent.keyDown(document.body, { key: "p", metaKey: true });
			const quickOpen = await screen.findByRole("textbox", { name: "Search files by name" });
			fireEvent.change(quickOpen, { target: { value: "appshell" } });
			expect(await screen.findByRole("button", { name: "src/app/AppShell.tsx" })).toBeTruthy();

			fireEvent.keyDown(quickOpen, { key: "Escape" });
			await waitFor(() =>
				expect(screen.queryByRole("textbox", { name: "Search files by name" })).toBeNull(),
			);

			fireEvent.keyDown(document.body, { key: "f", metaKey: true, shiftKey: true });
			const search = await screen.findByRole("searchbox", { name: "Search file contents" });
			fireEvent.change(search, { target: { value: "retry" } });
			expect(await screen.findByRole("region", { name: "src/retry.ts" })).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "src/retry.ts:1" }));
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({ tab: "file", path: "src/retry.ts" }),
			);

			fireEvent.keyDown(document.body, { key: "p", metaKey: true });
			const again = await screen.findByRole("textbox", { name: "Search files by name" });
			fireEvent.change(again, { target: { value: "appshell" } });
			await screen.findByRole("button", { name: "src/app/AppShell.tsx" });
			fireEvent.keyDown(again, { key: "Enter" });
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					tab: "file",
					path: "src/app/AppShell.tsx",
				}),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-02 opens settings with Cmd+, and finds and highlights a setting from the search", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			await test.container.services.repo.start();
			const router = await openApp(test.container, "/");

			fireEvent.keyDown(document.body, { key: ",", metaKey: true });
			await waitFor(() => expect(router.state.location.pathname).toBe("/settings/general"));

			await screen.findByRole("navigation", { name: "Settings" });
			const settingsScreen = await screen.findByTestId("settings-screen");
			fireEvent.keyDown(settingsScreen, { key: "f", metaKey: true });
			const search = await screen.findByRole("searchbox", { name: "Search settings" });
			expect(document.activeElement).toBe(search);

			fireEvent.change(search, { target: { value: "zoom" } });
			expect(await screen.findByRole("button", { name: /App zoom/ })).toBeTruthy();
			fireEvent.keyDown(search, { key: "Enter" });

			await waitFor(() => expect(router.state.location.pathname).toBe("/settings/appearance"));
			expect(await screen.findByRole("heading", { name: "Appearance" })).toBeTruthy();
			await waitFor(() =>
				expect(
					document
						.querySelector('[data-setting-key="zoom_level_v2"]')
						?.getAttribute("data-highlighted"),
				).toBe("true"),
			);

			fireEvent.keyDown(screen.getByTestId("settings-screen"), { key: "Escape" });
			await waitFor(() => expect(router.state.location.pathname).toBe("/"));

			await router.navigate({
				to: "/settings/repos/$repoId/$page",
				params: { repoId: "gone", page: "scripts" },
			});
			expect(await screen.findByRole("heading", { name: "Pick a project" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-06 applies the appearance shortcuts away from the Appearance page", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const router = await openApp(test.container, "/settings/general");
			await screen.findByRole("heading", { name: "General" });
			expect(router.state.location.pathname).toBe("/settings/general");

			fireEvent.keyDown(document, { key: "t", metaKey: true, altKey: true });

			await waitFor(() =>
				expect(test.container.services.settings.store.getState().values.theme).toBe("dark"),
			);
			await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));

			fireEvent.keyDown(document, { key: "=", metaKey: true });
			await waitFor(() =>
				expect(test.container.services.settings.store.getState().values.zoom_level_v2).toBe(1.1),
			);
			await waitFor(() =>
				expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.1"),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-08 opens the workspace in the header's Open in app", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/ws-08" });
			const saved = await test.container.actions.settings.set("default_open_in", "Finder");
			expect(saved.ok).toBe(true);
			// Calls through to the in-memory opener; the spy only records what reached the Platform.
			const openWith = vi.spyOn(test.memory.platform.opener, "openWith");

			await openApp(test.container, `/repository/${workspace.repoId}/workspace/${workspace.id}`);

			const openButton = await screen.findByRole("button", { name: /^Finder$/ });
			fireEvent.click(openButton);

			await waitFor(() => expect(openWith).toHaveBeenCalledWith("Finder", workspace.path));
			await waitFor(() => expect((openButton as HTMLButtonElement).disabled).toBe(false));

			fireEvent.keyDown(document.body, { key: "o", metaKey: true });
			await waitFor(() => expect(openWith).toHaveBeenCalledTimes(2));
			expect(openWith).toHaveBeenLastCalledWith("Finder", workspace.path);

			fireEvent.keyDown(document.body, { key: "o", metaKey: true, shiftKey: true });
			expect(await screen.findByRole("menu", { name: "Open in" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
