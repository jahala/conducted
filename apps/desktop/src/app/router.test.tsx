import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Container } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import type { Repo, Workspace } from "../core/model.ts";
import "../test/dom-polyfills.ts";
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
		displayName: null,
		targetBranch: "origin/main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 55_000,
		pinnedAt: null,
		notes: null,
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

async function openContainerApp(path: string, container: Container) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
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

async function openApp(path: string, repos: Repo[] = [], workspaces: Workspace[] = []) {
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
		expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Go forward" })).toBeTruthy();
		const nav = screen.getByRole("navigation", { name: "Main" });
		expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("href")).toBe(
			"/all-workspaces",
		);
		expect(within(nav).getByRole("link", { name: "Create" }).getAttribute("href")).toBe("/create");
		// The workspace list is built now and shows its empty state, while the footer keeps its own boundary.
		expect(screen.getByText("No projects yet")).toBeTruthy();
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
		expect(await within(main).findByText("Home")).toBeTruthy();
		expect(await within(main).findByText("No workspaces yet")).toBeTruthy();
		expect(within(main).getByRole("searchbox", { name: "Search workspaces" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("/dashboard renders inside the shell", async () => {
		await openApp("/dashboard");
		const main = await screen.findByRole("main");
		expect(await within(main).findByText("Dashboard")).toBeTruthy();
		expect(within(main).getByText("Not built yet: NAV-06")).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("/create renders the new-workspace page inside the shell", async () => {
		await openApp("/create", [repo("r1")]);
		const main = await screen.findByRole("main");
		expect(await within(main).findByRole("heading", { name: "New workspace" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
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

	it("/settings/general renders without the sidebar", async () => {
		await openApp("/settings/general");
		expect(await screen.findByRole("navigation", { name: "Settings" })).toBeTruthy();
		expect(await screen.findByRole("heading", { name: "General" })).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});

	it("/diagnostics renders without the sidebar", async () => {
		await openApp("/diagnostics");
		expect(await screen.findByText("Diagnostics")).toBeTruthy();
		expect(screen.getByText("Not built yet: APP-03")).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});

	it("/first-run-onboarding renders without the sidebar", async () => {
		await openApp("/first-run-onboarding");
		expect(
			await screen.findByRole("heading", { name: "Get coding agents working in parallel" }),
		).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});

	it("sends /settings to the general page", async () => {
		const router = await openApp("/settings");
		expect(await screen.findByRole("heading", { name: "General" })).toBeTruthy();
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
