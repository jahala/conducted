import type { RepoId, WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
	set: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock("../../core/hooks.ts", () => ({
	useSetting: (key: string) => {
		if (key === "sidebar_group_by") return settings.group;
		if (key === "sidebar_sort_by") return settings.sort;
		return settings.filter;
	},
	useActions: () => ({ settings: { set: settings.set } }),
	useShortcutOverrides: () => ({ overrides: {}, error: null }),
}));

vi.mock("./WorkspaceRow.tsx", () => ({
	WorkspaceRow: ({ workspace }: { workspace: Workspace }) => (
		<div data-testid="workspace-row">{workspace.displayName}</div>
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
		displayName: id,
		targetBranch: "main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 0,
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
		...overrides,
	};
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
		expect(await screen.findByRole("region", { name: "Pinned" })).toBeTruthy();
		const pinned = screen.getByRole("region", { name: "Pinned" });
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

	it("shows the empty note when no project matches the filter", async () => {
		settings.group = "repo";
		settings.filter = "api";
		renderWithRouter(
			<GroupedWorkspaces repos={[repo("app"), repo("api")]} workspaces={[workspace("one")]} />,
		);
		expect(await screen.findByText("No matching workspaces")).toBeTruthy();
		settings.filter = "";
	});

	it("puts the project header and its + action in one row above the workspaces", async () => {
		renderWithRouter(<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one")]} />);
		const region = await screen.findByRole("region", { name: "app" });
		const plus = within(region).getByRole("link", { name: "Create workspace in app" });
		const trigger = within(region).getByRole("button", { name: "app" });
		expect(plus.parentElement).toBe(trigger.parentElement);
		const row = within(region).getByTestId("workspace-row");
		expect(plus.parentElement?.contains(row)).toBe(false);
	});

	it("collapses a group and shows its count while closed", async () => {
		renderWithRouter(
			<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one"), workspace("two")]} />,
		);
		const region = await screen.findByRole("region", { name: "app" });
		const trigger = within(region).getByRole("button", { name: "app" });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(within(region).queryByTestId("workspace-row")).toBeNull();
		expect(within(region).getByText("2")).toBeTruthy();
		fireEvent.click(trigger);
		expect(within(region).getAllByTestId("workspace-row")).toHaveLength(2);
	});

	it("saves only the view option that changed", async () => {
		renderWithRouter(<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one")]} />);
		fireEvent.click(await screen.findByRole("button", { name: "Group by status" }));
		expect(settings.set).toHaveBeenCalledTimes(1);
		expect(settings.set).toHaveBeenCalledWith("sidebar_group_by", "status");
	});

	it("explains that grouping by section is not available yet", async () => {
		settings.group = "section";
		renderWithRouter(<GroupedWorkspaces repos={[repo("app")]} workspaces={[workspace("one")]} />);
		expect(await screen.findByText("Grouping by section is not available yet.")).toBeTruthy();
		expect(screen.queryByRole("region", { name: "app" })).toBeNull();
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
});
