import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Container } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import type { Repo, Workspace } from "../core/model.ts";
import { useOverlayStore } from "./overlay-store.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";
import { createShellContainer } from "./shell-test-support.ts";

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

function workspace(id: string, repoId: string): Workspace {
	return {
		id: id as Workspace["id"],
		repoId: repoId as Workspace["repoId"],
		directoryName: id,
		path: `/repos/${id}`,
		branch: `jahala/${id}`,
		branchIsPlaceholder: false,
		host: { kind: "local" },
		displayName: null,
		targetBranch: "origin/main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 55_000,
		pinnedAt: null,
		linkedPaths: [],
		prNumber: null,
		prTitle: null,
		prDescription: null,
		archiveCommit: null,
		archivedAt: null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 0,
		createdAt: 0,
		updatedAt: 0,
	};
}

async function openContainerApp(path: string | string[], container: Container) {
	const initialEntries = Array.isArray(path) ? path : [path];
	const router = createAppRouter(createMemoryHistory({ initialEntries }));
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

async function openApp(path: string | string[], repos: Repo[] = [], workspaces: Workspace[] = []) {
	return openContainerApp(path, createShellContainer({ repos, workspaces }).container);
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
		expect(screen.getByRole("button", { name: "Toggle sidebar", expanded: true })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Go forward" })).toBeTruthy();
		const nav = screen.getByRole("navigation", { name: "Main" });
		expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("href")).toBe(
			"/all-workspaces",
		);
		expect(within(nav).getByRole("link", { name: "Create" }).getAttribute("href")).toBe("/create");
		// The workspace list is built now and shows its empty state, while the footer keeps its own boundary.
		expect(screen.getByText("Add a project to get started.")).toBeTruthy();
	});

	it("opens the command palette from the Search row", async () => {
		await openApp("/");
		await screen.findByRole("heading", { name: "Run agents side by side" });
		fireEvent.click(screen.getByRole("button", { name: "Search" }));
		expect(useOverlayStore.getState().open).toBe("palette");
		expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(useOverlayStore.getState().open).toBeNull();
	});
});

describe("routes", () => {
	it("/all-workspaces renders the Home grid inside the shell", async () => {
		await openApp("/all-workspaces");
		const main = await screen.findByRole("main");
		expect(await within(main).findByText("No matching workspaces")).toBeTruthy();
		// Home has no title in its strip, as Conductor's Home has none (D098).
		expect(within(main).queryByRole("heading", { name: "Home" })).toBeNull();
		expect(within(main).getByRole("searchbox", { name: "Search" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("/dashboard renders inside the shell with its setting on", async () => {
		const shell = createShellContainer();
		shell.container.services.settings.store.setState((state) => ({
			values: { ...state.values, dashboard_enabled: true },
		}));
		await openContainerApp("/dashboard", shell.container);
		const main = await screen.findByRole("main");
		expect(await within(main).findByRole("heading", { name: "Dashboard" })).toBeTruthy();
		expect(within(main).getByRole("button", { name: "New workspace" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("/create opens the new-workspace dialog over the shell", async () => {
		// Conductor creates a workspace from a modal over the current screen, not a full page.
		await openApp("/create", [repo("r1")]);
		const dialog = await screen.findByRole("dialog", { name: "New workspace" });
		expect(within(dialog).getByLabelText("First message")).toBeTruthy();
		// The modal hides the shell from assistive technology while it is open; the shell is still drawn.
		expect(screen.getByRole("complementary", { name: "Sidebar", hidden: true })).toBeTruthy();
	});

	it("shows the workspace screen with its regions", async () => {
		const project = repo("r1");
		const seeded = workspace("w1", project.id);
		await openApp(`/repository/${project.id}/workspace/${seeded.id}?tab=pr`, [project], [seeded]);
		const main = await screen.findByRole("main");
		expect(await within(main).findByRole("tab", { name: "All files" })).toBeTruthy();
		expect(within(main).getByRole("tab", { name: "Setup" })).toBeTruthy();
		expect(await within(main).findByRole("tablist", { name: "Workspace tabs" })).toBeTruthy();
		expect(within(main).getByRole("tab", { name: "PR" })).toBeTruthy();
		expect(within(main).getByRole("button", { name: seeded.branch })).toBeTruthy();
	});

	it("explains when the workspace is missing", async () => {
		await openApp("/repository/r1/workspace/w1?tab=pr");
		const main = await screen.findByRole("main");
		expect(await within(main).findByText("Workspace not found")).toBeTruthy();
	});

	it("ignores a bad tab in the workspace URL instead of failing", async () => {
		await openApp("/repository/r1/workspace/w1?tab=nonsense&line=0");
		const main = await screen.findByRole("main");
		expect(await within(main).findByRole("tab", { name: "All files" })).toBeTruthy();
	});

	it("/settings/user/general renders without the sidebar", async () => {
		await openApp("/settings/user/general");
		expect(await screen.findByRole("navigation", { name: "Settings" })).toBeTruthy();
		expect(await screen.findByRole("heading", { name: "General" })).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});

	it("puts Back and the settings top bar in the title bar row, with no strip above them", async () => {
		await openApp("/settings/user/general");
		const settings = await screen.findByTestId("settings-screen");
		await screen.findByRole("heading", { name: "General" });

		// Conductor's settings screen draws its own drag regions: the row holding Back at the top of
		// the nav, and the 40 px top bar of the page column. Nothing sits above them.
		const regions = [...document.querySelectorAll("[data-tauri-drag-region]")];
		expect(regions.length).toBeGreaterThan(0);
		expect(regions.every((region) => settings.contains(region))).toBe(true);
		const back = screen.getByRole("button", { name: "Back" });
		expect(regions.some((region) => region.contains(back))).toBe(true);
		expect(screen.getByTestId("settings-top-bar").hasAttribute("data-tauri-drag-region")).toBe(
			true,
		);
	});

	it("returns to the previous screen when Settings goes Back", async () => {
		const router = await openApp(["/all-workspaces", "/settings/user/general"]);
		await screen.findByRole("heading", { name: "General" });

		fireEvent.click(screen.getByRole("button", { name: "Back" }));

		await waitFor(() => expect(router.state.location.pathname).toBe("/all-workspaces"));
	});

	it("/diagnostics renders without the sidebar", async () => {
		await openApp("/diagnostics");
		expect(await screen.findByRole("heading", { name: "Diagnostics" })).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});

	it("/first-run-onboarding renders without the sidebar", async () => {
		await openApp("/first-run-onboarding");
		// Conductor's first slide, as the current step of the onboarding list.
		expect(
			await screen.findByRole("button", {
				name: /^Get coding agents working in parallel/,
				current: "step",
			}),
		).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});

	it("sends /settings to the general page", async () => {
		const router = await openApp("/settings");
		expect(await screen.findByRole("heading", { name: "General" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/settings/user/general");
	});

	it("shows a designed screen for an unknown address", async () => {
		await openApp("/nowhere");
		expect(await screen.findByRole("heading", { name: "Not Found" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Go to Home" }).getAttribute("href")).toBe(
			"/all-workspaces",
		);
	});
});
