import type { RepoId, WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, runCommandHandlers } from "../../app/command-dispatcher.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import type { SidebarView } from "./sidebar-view.ts";

const settings = vi.hoisted(() => ({
	group: "repo",
	sort: "updated",
	filter: "",
	collapsed: false,
	set: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock("../../core/hooks.ts", () => ({
	useSetting: (key: string) => {
		if (key === "sidebar_group_by") return settings.group;
		if (key === "sidebar_sort_by") return settings.sort;
		if (key === "sidebar_my_workspaces_collapsed") return settings.collapsed;
		return settings.filter;
	},
	useActions: () => ({
		settings: { set: settings.set },
		sections: { place: vi.fn(async () => ({ ok: true, value: undefined })) },
	}),
	useRepos: () => ({
		state: "ready",
		data: [
			{ id: "app", name: "app", hidden: false, displayOrder: 0 },
			{ id: "api", name: "api", hidden: false, displayOrder: 1 },
		],
	}),
	useSections: () => ({ state: "ready", data: [] }),
	useShortcutOverrides: () => ({ overrides: {}, error: null }),
}));

vi.mock("./WorkspaceRow.tsx", () => ({
	WorkspaceRow: ({
		workspace,
		shortcutIndex,
		...rest
	}: {
		workspace: Workspace;
		shortcutIndex: number | null;
	}) => (
		<div
			data-testid="workspace-row"
			data-shortcut={shortcutIndex ?? undefined}
			data-now={"now" in rest ? String(rest.now) : undefined}
		>
			{workspace.displayName}
		</div>
	),
}));

vi.mock("./ViewOptionsMenu.tsx", () => ({
	ViewOptionsMenu: ({
		view,
		onChange,
	}: {
		view: SidebarView;
		onChange: (view: SidebarView) => void;
	}) => (
		<button type="button" onClick={() => onChange({ ...view, groupBy: "status" })}>
			Group by status
		</button>
	),
}));

const { GroupedWorkspaces } = await import("./GroupedWorkspaces.tsx");

beforeEach(() => {
	settings.group = "repo";
	settings.sort = "updated";
	settings.filter = "";
	settings.collapsed = false;
	settings.set.mockClear();
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
});

function repo(id: string): Repo {
	return {
		id: id as RepoId,
		name: id,
		rootPath: `/repos/${id}`,
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
		displayOrder: id === "app" ? 0 : 1,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
	};
}

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: id as WorkspaceId,
		repoId: "app" as RepoId,
		directoryName: id,
		path: `/workspaces/${id}`,
		branch: `branch-${id}`,
		branchIsPlaceholder: false,
		remoteFileSyncEnabled: false,
		host: { kind: "local" },
		displayName: id,
		targetBranch: "main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 0,
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
		...overrides,
	};
}

/** Renders the list on a workspace's route, so that workspace is the open one. */
function renderInRouterAt(ui: ReactNode, path: string) {
	const rootRoute = createRootRoute({ component: () => <>{ui}</> });
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([workspaceRoute]),
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	render(<RouterProvider router={router} />);
	return router;
}

function renderInRouter(ui: ReactNode) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{ui}</>,
	});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <p>workspace</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, workspaceRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(<RouterProvider router={router} />);
	return router;
}

/** Opens every main group: with no workspace open, Conductor's groups start closed. */
async function openGroups() {
	await screen.findAllByRole("region");
	for (const trigger of screen.queryAllByRole("button", { expanded: false })) {
		fireEvent.click(trigger);
	}
}

describe("NAV-03 GroupedWorkspaces", () => {
	it("groups by project and shows a pinned workspace only in Pinned", async () => {
		settings.group = "repo";
		renderWithRouter(
			<GroupedWorkspaces
				repos={[repo("app"), repo("api")]}
				workspaces={[
					workspace("one", { pinnedAt: 1 }),
					workspace("two"),
					workspace("three", { repoId: "api" as RepoId }),
				]}
			/>,
		);
		expect(await screen.findByRole("region", { name: "Pinned workspaces" })).toBeTruthy();
		await openGroups();
		const pinned = screen.getByRole("region", { name: "Pinned workspaces" });
		expect(within(pinned).getAllByTestId("workspace-row")).toHaveLength(1);
		expect(within(pinned).getByText("one")).toBeTruthy();
		const app = screen.getByRole("region", { name: "app" });
		expect(within(app).getByText("two")).toBeTruthy();
		expect(within(app).queryByText("one")).toBeNull();
		expect(screen.getByRole("region", { name: "api" })).toBeTruthy();
	});

	it("groups by status when that setting is chosen", async () => {
		settings.group = "status";
		renderWithRouter(
			<GroupedWorkspaces
				repos={[repo("app")]}
				workspaces={[
					workspace("done", { kanbanStatus: "done" }),
					workspace("progress", { kanbanStatus: "in_progress" }),
				]}
			/>,
		);
		expect(await screen.findByRole("region", { name: "Done" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "In progress" })).toBeTruthy();
	});

	it("shows the filtered project's empty group with its + instead of the empty note", async () => {
		settings.group = "repo";
		settings.filter = "api";
		renderWithRouter(
			<GroupedWorkspaces repos={[repo("app"), repo("api")]} workspaces={[workspace("one")]} />,
		);
		const api = await screen.findByRole("region", { name: "api" });
		expect(within(api).getByRole("link", { name: "Create workspace in api" })).toBeTruthy();
		expect(within(api).queryByTestId("workspace-row")).toBeNull();
		expect(screen.queryByText("No matching workspaces")).toBeNull();
		settings.filter = "";
	});

	it("shows the empty note when a filter leaves no status group", async () => {
		settings.group = "status";
		settings.filter = "api";
		renderWithRouter(
			<GroupedWorkspaces repos={[repo("app"), repo("api")]} workspaces={[workspace("one")]} />,
		);
		expect(await screen.findByText("No matching workspaces")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Clear filter" })).toBeTruthy();
		settings.filter = "";
	});

	it("keeps a project's group and its + when its last workspace is archived", async () => {
		renderWithRouter(
			<GroupedWorkspaces
				repos={[repo("app"), repo("api")]}
				workspaces={[workspace("one", { state: "archived", archivedAt: 1 })]}
			/>,
		);
		const app = await screen.findByRole("region", { name: "app" });
		const api = screen.getByRole("region", { name: "api" });
		expect(within(app).queryByTestId("workspace-row")).toBeNull();
		expect(within(app).getByRole("link", { name: "Create workspace in app" })).toBeTruthy();
		expect(within(api).getByRole("link", { name: "Create workspace in api" })).toBeTruthy();
	});

	it("puts the project header and its + action in one row above the workspaces", async () => {
		renderWithRouter(<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one")]} />);
		const region = await screen.findByRole("region", { name: "app" });
		await openGroups();
		const plus = within(region).getByRole("link", { name: "Create workspace in app" });
		expect(plus.getAttribute("href")).toBe("/create?repo=app");
		const trigger = within(region).getByRole("button", { name: "app" });
		expect(plus.parentElement).toBe(trigger.parentElement);
		const row = within(region).getByTestId("workspace-row");
		expect(plus.parentElement?.contains(row)).toBe(false);
	});

	it("opens only the group of the open workspace at first, as Conductor does", async () => {
		renderInRouterAt(
			<GroupedWorkspaces
				repos={[repo("app"), repo("api")]}
				workspaces={[workspace("one"), workspace("three", { repoId: "api" as RepoId })]}
			/>,
			"/repository/api/workspace/three",
		);
		const app = await screen.findByRole("region", { name: "app" });
		const api = screen.getByRole("region", { name: "api" });
		expect(within(app).getByRole("button", { name: /^app/ }).getAttribute("aria-expanded")).toBe(
			"false",
		);
		expect(within(app).queryByTestId("workspace-row")).toBeNull();
		expect(within(app).getByText("1")).toBeTruthy();
		expect(within(api).getAllByTestId("workspace-row")).toHaveLength(1);
	});

	it("collapses a group and shows its count while closed", async () => {
		renderWithRouter(
			<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one"), workspace("two")]} />,
		);
		const region = await screen.findByRole("region", { name: "app" });
		await openGroups();
		const trigger = within(region).getByRole("button", { name: "app" });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(within(region).queryByTestId("workspace-row")).toBeNull();
		expect(within(region).getByText("2")).toBeTruthy();
		fireEvent.click(trigger);
		expect(within(region).getAllByTestId("workspace-row")).toHaveLength(2);
	});

	it("numbers only the rows the user can see after a group is collapsed", async () => {
		renderWithRouter(
			<GroupedWorkspaces
				repos={[repo("app"), repo("api")]}
				workspaces={[
					workspace("one", { lastActivityAt: 30 }),
					workspace("two", { lastActivityAt: 20 }),
					workspace("three", { repoId: "api" as RepoId, lastActivityAt: 10 }),
				]}
			/>,
		);
		const app = await screen.findByRole("region", { name: "app" });
		await openGroups();
		const api = screen.getByRole("region", { name: "api" });
		expect(within(api).getByTestId("workspace-row").getAttribute("data-shortcut")).toBe("3");
		fireEvent.click(within(app).getByRole("button", { name: "app" }));
		expect(within(api).getByTestId("workspace-row").getAttribute("data-shortcut")).toBe("1");
	});

	it("skips collapsed groups for Cmd+1..9", async () => {
		const router = renderInRouter(
			<GroupedWorkspaces
				repos={[repo("app"), repo("api")]}
				workspaces={[
					workspace("one", { lastActivityAt: 30 }),
					workspace("two", { lastActivityAt: 20 }),
					workspace("three", { repoId: "api" as RepoId, lastActivityAt: 10 }),
				]}
			/>,
		);
		const app = await screen.findByRole("region", { name: "app" });
		await openGroups();
		fireEvent.click(within(app).getByRole("button", { name: "app" }));
		await waitFor(() => expect(runCommandHandlers("workspace.switch1")).toBe(true));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/repository/api/workspace/three"),
		);
	});

	it("saves only the view option that changed", async () => {
		renderWithRouter(<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one")]} />);
		fireEvent.click(await screen.findByRole("button", { name: "Group by status" }));
		expect(settings.set).toHaveBeenCalledTimes(1);
		expect(settings.set).toHaveBeenCalledWith("sidebar_group_by", "status");
	});

	it("shows the list when the saved grouping is section", async () => {
		settings.group = "section";
		renderWithRouter(<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one")]} />);
		expect(await screen.findByRole("region", { name: "app" })).toBeTruthy();
		expect(screen.queryByText("Grouping by section is not available yet.")).toBeNull();
	});

	it("uses the same row order for Cmd+1..9 and previous/next", async () => {
		const router = renderInRouter(
			<GroupedWorkspaces
				repos={[repo("app")]}
				workspaces={[
					workspace("one", { lastActivityAt: 30 }),
					workspace("two", { lastActivityAt: 20 }),
					workspace("three", { lastActivityAt: 10 }),
				]}
			/>,
		);
		await screen.findByRole("region", { name: "app" });
		await openGroups();
		await waitFor(() => expect(runCommandHandlers("workspace.switch2")).toBe(true));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/repository/app/workspace/two"),
		);
	});

	it("goes to the last workspace for previous and the first for next when none is open", async () => {
		const previousRouter = renderInRouter(
			<GroupedWorkspaces
				repos={[repo("app")]}
				workspaces={[
					workspace("one", { lastActivityAt: 30 }),
					workspace("two", { lastActivityAt: 20 }),
					workspace("three", { lastActivityAt: 10 }),
				]}
			/>,
		);
		await screen.findByRole("region", { name: "app" });
		await openGroups();
		await waitFor(() => expect(runCommandHandlers("workspace.previous")).toBe(true));
		await waitFor(() =>
			expect(previousRouter.state.location.pathname).toBe("/repository/app/workspace/three"),
		);
		cleanup();

		const nextRouter = renderInRouter(
			<GroupedWorkspaces
				repos={[repo("app")]}
				workspaces={[
					workspace("one", { lastActivityAt: 30 }),
					workspace("two", { lastActivityAt: 20 }),
				]}
			/>,
		);
		await screen.findByRole("region", { name: "app" });
		await openGroups();
		await waitFor(() => expect(runCommandHandlers("workspace.next")).toBe(true));
		await waitFor(() =>
			expect(nextRouter.state.location.pathname).toBe("/repository/app/workspace/one"),
		);
	});

	it("does not swallow a number shortcut past the end of the list", async () => {
		renderWithRouter(<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one")]} />);
		await screen.findByRole("region", { name: "app" });
		await waitFor(() => expect(runCommandHandlers("workspace.switch9")).toBe(false));
	});

	// Conductor's row shows no time, so the rows get none and the list runs no minute timer (D098).
	// This test asserted the shared minute timer that fed every row's time.
	it("gives the rows no time and runs no minute timer", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		const interval = vi.spyOn(globalThis, "setInterval");
		try {
			renderWithRouter(
				<GroupedWorkspaces
					repos={[repo("app")]}
					workspaces={[workspace("one"), workspace("two")]}
				/>,
			);
			await openGroups();
			const rows = await screen.findAllByTestId("workspace-row");
			expect(rows.map((row) => row.getAttribute("data-now"))).toEqual([null, null]);
			act(() => {
				vi.advanceTimersByTime(60_000);
			});
			expect(interval).not.toHaveBeenCalledWith(expect.any(Function), 60_000);
		} finally {
			interval.mockRestore();
			vi.useRealTimers();
		}
	});
});
