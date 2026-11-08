/**
 * @feature NAV-10 Workspace header
 * Owns: tests for the breadcrumb, the branch menu and its rename dialog, the target branch
 * popover, the folder name, loading, error and archived states. Conductor's header has no
 * workspace name, rename button, actions button or folder chip (D098); the tests say so.
 * Test first: Renders the branch and the Open in menu; the toggle button reflects rightPanelOpen.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Repo, Workspace } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	workspace: {
		state: "ready",
		data: {
			displayName: "Fix login",
			branch: "fix-login",
			branchIsPlaceholder: false,
			targetBranch: "main",
			directoryName: "quiet-meadow",
			path: "/code/workspaces/quiet-meadow",
			state: "ready",
			host: { kind: "local" },
		},
	} as Loadable<Workspace>,
	repos: {
		state: "ready",
		data: [{ id: "r1", name: "Conducted", remoteUrl: "git@github.com:jahala/conducted.git" }],
	} as Loadable<Repo[]>,
	settings: {} as Record<string, string>,
	openUrl: vi.fn(),
	copyText: vi.fn(),
	rename: vi.fn(),
	setTargetBranch: vi.fn(),
	renameBranch: vi.fn(),
}));

const workspace = (over: Partial<Workspace> = {}): Workspace =>
	({
		displayName: "Fix login",
		branch: "fix-login",
		branchIsPlaceholder: false,
		targetBranch: "main",
		directoryName: "quiet-meadow",
		path: "/code/workspaces/quiet-meadow",
		state: "ready",
		host: { kind: "local" },
		...over,
	}) as Workspace;

vi.mock("../../core/hooks.ts", () => ({
	useWorkspace: () => state.workspace,
	useRepos: () => state.repos,
	useBranches: () => ({ state: "ready", data: ["main", "develop"] }),
	useSetting: (key: string) => state.settings[key] ?? "",
	useCloudWorkspace: () => ({
		status: "unknown",
		resources: { cpu: null, memory: null, disk: null },
		agentCostUsd: null,
		error: null,
	}),
	useGitHubAccess: () => ({ state: "loading" }),
	useActions: () => ({
		app: { copyText: state.copyText, openUrl: state.openUrl },
		workspaces: { rename: state.rename, setTargetBranch: state.setTargetBranch },
		git: { renameBranch: state.renameBranch },
	}),
}));

// OpenInMenu is WS-08's and still a placeholder. A stand-in keeps these tests about the header.
vi.mock("../open-in/OpenInMenu.tsx", () => ({
	OpenInMenu: () => <button type="button">Open in</button>,
}));

const { WorkspaceHeader } = await import("./WorkspaceHeader.tsx");

const workspaceId = "w1" as WorkspaceId;
const repoId = "r1" as RepoId;

const header = () => (
	<WorkspaceHeader
		repoId={repoId}
		workspaceId={workspaceId}
		controls={{ rightPanelOpen: true, toggleRightPanel: vi.fn() }}
	/>
);

/** The header under a router, as the repository menu navigates to the repository's settings. */
const renderHeader = async () => {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				{header()}
				<Outlet />
			</>
		),
	});
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings/repos/$repoId/$page",
		component: () => <p>repository settings page</p>,
	});
	const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute, settingsRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	const view = render(<RouterProvider router={router} />);
	await act(() => router.load());
	return { router, ...view };
};

beforeEach(() => {
	for (const fn of [state.copyText, state.rename, state.setTargetBranch, state.renameBranch]) {
		fn.mockReset();
		fn.mockResolvedValue({ ok: true, value: undefined });
	}
	state.workspace = { state: "ready", data: workspace() };
	state.settings = {};
	state.openUrl.mockReset();
	state.openUrl.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(cleanup);

describe("NAV-10 WorkspaceHeader", () => {
	it("shows the branch without the user's prefix, and still copies the whole branch", async () => {
		state.settings = { branch_prefix_type: "custom", branch_prefix_custom: "sam/" };
		state.workspace = { state: "ready", data: workspace({ branch: "sam/fix-login" }) };
		await renderHeader();
		const branch = await screen.findByRole("button", { name: "fix-login" });
		fireEvent.contextMenu(branch);
		fireEvent.click(await screen.findByRole("menuitem", { name: /Copy/ }));
		await waitFor(() => expect(state.copyText).toHaveBeenCalledWith("sam/fix-login"));
	});

	it("opens the repository's menu: Repository settings and Open on GitHub, as Conductor's", async () => {
		const { router } = await renderHeader();
		const trigger = await screen.findByRole("button", { name: "Conducted" });
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Open on GitHub" }));
		await waitFor(() =>
			expect(state.openUrl).toHaveBeenCalledWith("https://github.com/jahala/conducted"),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Conducted" }), { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Repository settings" }));
		await waitFor(() => expect(router.state.location.pathname).toBe("/settings/repos/r1/misc"));
	});

	it("shows the repository, branch and Open in, with no workspace name or actions button", async () => {
		await renderHeader();
		expect(screen.getByText("Conducted")).toBeTruthy();
		expect(screen.getByText("fix-login")).toBeTruthy();
		// Conductor's header names the branch only; the workspace's name and its actions are the
		// sidebar row's (D098).
		expect(screen.queryByText("Fix login")).toBeNull();
		expect(screen.getByRole("button", { name: "Open in" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Workspace actions" })).toBeNull();
	});

	it("shows the folder name when it differs from the branch", async () => {
		state.workspace = {
			state: "ready",
			data: workspace({ displayName: null, prTitle: null, branch: "" }),
		};
		await renderHeader();
		expect(screen.getByTitle("quiet-meadow").textContent).toBe("quiet-meadow");
	});

	it("reports the right panel state and toggles it", async () => {
		const toggleRightPanel = vi.fn();
		const { rerender } = render(
			<WorkspaceHeader
				repoId={repoId}
				workspaceId={workspaceId}
				controls={{ rightPanelOpen: true, toggleRightPanel }}
			/>,
		);
		const toggle = screen.getByRole("button", { name: "Toggle right sidebar" });
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(toggle);
		expect(toggleRightPanel).toHaveBeenCalledTimes(1);
		rerender(
			<WorkspaceHeader
				repoId={repoId}
				workspaceId={workspaceId}
				controls={{ rightPanelOpen: false, toggleRightPanel }}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Toggle right sidebar" }).getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("has no folder chip: copying the path is the Open in menu's last item", async () => {
		await renderHeader();
		// Conductor's folder name is plain text beside Open in, whose menu ends with "Copy path"
		// (D098; OpenInMenu.ws-08.test.tsx copies it).
		expect(screen.queryByTitle("Copy folder path")).toBeNull();
		expect(screen.getByTitle("quiet-meadow").tagName).toBe("SPAN");
	});

	it("copies the branch from the branch menu with C", async () => {
		await renderHeader();
		fireEvent.contextMenu(screen.getByText("fix-login"));
		const copy = await screen.findByRole("menuitem", { name: /Copy/ });
		fireEvent.keyDown(copy, { key: "c" });
		await waitFor(() => expect(state.copyText).toHaveBeenCalledWith("fix-login"));
	});

	it("renames the branch from the branch menu with R", async () => {
		await renderHeader();
		fireEvent.contextMenu(screen.getByText("fix-login"));
		const rename = await screen.findByRole("menuitem", { name: /Rename/ });
		fireEvent.keyDown(rename, { key: "r" });
		const field = await screen.findByRole("textbox", { name: "Name" });
		fireEvent.change(field, { target: { value: "fix-login-2" } });
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		await waitFor(() =>
			expect(state.renameBranch).toHaveBeenCalledWith(workspaceId, "fix-login-2"),
		);
	});

	it("renames the branch with a click on it, as Conductor's header does", async () => {
		await renderHeader();
		// Renaming the workspace moved to the sidebar row's menu (D098); the branch is renamed here.
		expect(screen.queryByRole("button", { name: "Rename workspace" })).toBeNull();
		fireEvent.click(screen.getByText("fix-login"));
		const field = await screen.findByRole("textbox", { name: "Name" });
		expect((field as HTMLInputElement).value).toBe("fix-login");
		fireEvent.change(field, { target: { value: "fix-login-3" } });
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		await waitFor(() =>
			expect(state.renameBranch).toHaveBeenCalledWith(workspaceId, "fix-login-3"),
		);
	});

	it("changes the target branch from the popover behind the ellipsis", async () => {
		await renderHeader();
		fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
		fireEvent.click(await screen.findByRole("option", { name: /develop/ }));
		await waitFor(() => expect(state.setTargetBranch).toHaveBeenCalledWith(workspaceId, "develop"));
	});

	it("says an archived workspace's target branch cannot change", async () => {
		state.workspace = { state: "ready", data: workspace({ state: "archived" }) };
		await renderHeader();
		fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
		expect(
			await screen.findByText("Target branch cannot be changed for archived workspaces"),
		).toBeTruthy();
		expect(screen.queryByRole("option")).toBeNull();
	});

	it("shows the loading state", async () => {
		state.workspace = { state: "loading" };
		await renderHeader();
		expect(screen.getByRole("status", { name: "Loading workspace" })).toBeTruthy();
	});

	it("shows the load error", async () => {
		state.workspace = { state: "error", error: { code: "db", message: "The database is busy." } };
		await renderHeader();
		expect(screen.getByRole("alert").textContent).toContain("The database is busy.");
	});

	it("hides Open in for an archived workspace", async () => {
		state.workspace = { state: "ready", data: workspace({ state: "archived" }) };
		await renderHeader();
		expect(screen.queryByRole("button", { name: "Open in" })).toBeNull();
	});
});
