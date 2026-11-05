import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Container } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import type { Repo } from "../core/model.ts";
import { RepoService, type RepoServiceDeps } from "../core/services/repo.ts";
import "../test/dom-polyfills.ts";
import { useOverlayStore } from "./overlay-store.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

afterEach(cleanup);
beforeEach(() => useOverlayStore.getState().close());

function repo(id: string): Repo {
	return {
		id: id as Repo["id"],
		name: id,
		rootPath: `/repos/${id}`,
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
		displayOrder: 0,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
	};
}

/** The sidebar reads the repo and workspace stores; the shell reads the sidebar settings. */
function testContainer(repos: Repo[] = []): Container {
	const settings = {
		store: createStore<{ values: Record<string, unknown> }>(() => ({ values: {} })),
		get: (key: string): unknown =>
			({
				left_panel_visible: true,
				left_panel_width: 256,
				keybinding_overrides_v1: "",
				dashboard_enabled: false,
			})[key],
		set: async () => undefined,
	};
	const repoService = new RepoService({} as RepoServiceDeps);
	repoService.store.setState({
		loaded: true,
		reposById: Object.fromEntries(repos.map((row) => [row.id, row])),
		order: repos.map((row) => row.id),
		configs: {},
	});
	const workspaceStore = createStore(() => ({
		loaded: true,
		workspacesById: {},
		setup: {},
		archiving: {},
	}));
	return {
		services: {
			repo: repoService,
			workspace: { store: workspaceStore },
			settings,
			sections: { store: createStore(() => ({ loaded: true, sections: [] })) },
		},
		actions: {},
	} as unknown as Container;
}

async function openApp(path: string, repos: Repo[] = []) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<ServicesProvider container={testContainer(repos)}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

describe("app shell", () => {
	it("opens to the centre empty state with a sidebar next to it", async () => {
		await openApp("/");
		expect(await screen.findByRole("heading", { name: "Run agents side by side" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
		expect(screen.getByRole("main")).toBeTruthy();
	});

	it("keeps the window controls and navigation when a feature is not built", async () => {
		await openApp("/");
		await screen.findByRole("heading", { name: "Run agents side by side" });
		expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Go forward" })).toBeTruthy();
		const nav = screen.getByRole("navigation", { name: "Main" });
		expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("href")).toBe(
			"/all-workspaces",
		);
		expect(within(nav).getByRole("link", { name: "New workspace" }).getAttribute("href")).toBe(
			"/create",
		);
		// The workspace list needs data hooks that are not built; only that region says so.
		expect(screen.getByText("Not built yet: NAV-03")).toBeTruthy();
	});

	it("opens the command palette from the Search row", async () => {
		await openApp("/");
		await screen.findByRole("heading", { name: "Run agents side by side" });
		fireEvent.click(screen.getByRole("button", { name: "Search" }));
		expect(useOverlayStore.getState().open).toBe("palette");
		expect(await screen.findByText("Command palette")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(useOverlayStore.getState().open).toBeNull();
	});
});

describe("routes", () => {
	it.each([
		["/all-workspaces", "Home", "NAV-05"],
		["/dashboard", "Dashboard", "NAV-06"],
	])("%s renders inside the shell", async (path, area, id) => {
		await openApp(path);
		const main = await screen.findByRole("main");
		expect(await within(main).findByText(area)).toBeTruthy();
		expect(within(main).getByText(`Not built yet: ${id}`)).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("/create renders the new-workspace page inside the shell", async () => {
		await openApp("/create", [repo("r1")]);
		const main = await screen.findByRole("main");
		expect(await within(main).findByRole("heading", { name: "New workspace" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("shows the workspace screen with every region", async () => {
		await openApp("/repository/r1/workspace/w1?tab=pr");
		const main = await screen.findByRole("main");
		expect(await within(main).findByText("Git panel")).toBeTruthy();
		expect(within(main).getByText("Scripts")).toBeTruthy();
		expect(within(main).getByText("Tabs: Not built yet: NAV-10")).toBeTruthy();
		expect(within(main).getByText("Workspace header: Not built yet: NAV-10")).toBeTruthy();
	});

	it("ignores a bad tab in the workspace URL instead of failing", async () => {
		await openApp("/repository/r1/workspace/w1?tab=nonsense&line=0");
		const main = await screen.findByRole("main");
		expect(await within(main).findByText("Git panel")).toBeTruthy();
	});

	it.each([
		["/settings/general", "Settings", "SET-02"],
		["/diagnostics", "Diagnostics", "APP-03"],
		["/first-run-onboarding", "Welcome", "APP-02"],
	])("%s renders without the sidebar", async (path, area, id) => {
		await openApp(path);
		expect(await screen.findByText(area)).toBeTruthy();
		expect(screen.getByText(`Not built yet: ${id}`)).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});

	it("sends /settings to the general page", async () => {
		const router = await openApp("/settings");
		expect(await screen.findByText("Settings")).toBeTruthy();
		expect(router.state.location.pathname).toBe("/settings/general");
	});

	it("shows a designed screen for an unknown address", async () => {
		await openApp("/nowhere");
		expect(await screen.findByRole("heading", { name: "Not Found" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Go to Home" }).getAttribute("href")).toBe(
			"/all-workspaces",
		);
	});
});
