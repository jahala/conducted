/**
 * @feature NAV-10 Workspace header
 * Owns: tests for the breadcrumb, the branch menu and its rename dialog, the target branch
 * popover, the folder name, loading, error and archived states. Conductor's header has no
 * workspace name, rename button, actions button or folder chip (D098); the tests say so.
 * Test first: Renders the branch and the Open in menu; the toggle button reflects rightPanelOpen.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
		},
	} as Loadable<Workspace>,
	repos: {
		state: "ready",
		data: [{ id: "r1", name: "Conducted" }],
	} as Loadable<Repo[]>,
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
		...over,
	}) as Workspace;

vi.mock("../../core/hooks.ts", () => ({
	useWorkspace: () => state.workspace,
	useRepos: () => state.repos,
	useBranches: () => ({ state: "ready", data: ["main", "develop"] }),
	useActions: () => ({
		app: { copyText: state.copyText },
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

const renderHeader = () =>
	render(
		<WorkspaceHeader
			repoId={repoId}
			workspaceId={workspaceId}
			controls={{ rightPanelOpen: true, toggleRightPanel: vi.fn() }}
		/>,
	);

beforeEach(() => {
	for (const fn of [state.copyText, state.rename, state.setTargetBranch, state.renameBranch]) {
		fn.mockReset();
		fn.mockResolvedValue({ ok: true, value: undefined });
	}
	state.workspace = { state: "ready", data: workspace() };
});

afterEach(cleanup);

describe("NAV-10 WorkspaceHeader", () => {
	it("shows the repository, branch and Open in, with no workspace name or actions button", () => {
		renderHeader();
		expect(screen.getByText("Conducted")).toBeTruthy();
		expect(screen.getByText("fix-login")).toBeTruthy();
		// Conductor's header names the branch only; the workspace's name and its actions are the
		// sidebar row's (D098).
		expect(screen.queryByText("Fix login")).toBeNull();
		expect(screen.getByRole("button", { name: "Open in" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Workspace actions" })).toBeNull();
	});

	it("shows the folder name when it differs from the branch", () => {
		state.workspace = {
			state: "ready",
			data: workspace({ displayName: null, prTitle: null, branch: "" }),
		};
		renderHeader();
		expect(screen.getByTitle("quiet-meadow").textContent).toBe("quiet-meadow");
	});

	it("reports the right panel state and toggles it", () => {
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

	it("has no folder chip: copying the path is the Open in menu's last item", () => {
		renderHeader();
		// Conductor's folder name is plain text beside Open in, whose menu ends with "Copy path"
		// (D098; OpenInMenu.ws-08.test.tsx copies it).
		expect(screen.queryByTitle("Copy folder path")).toBeNull();
		expect(screen.getByTitle("quiet-meadow").tagName).toBe("SPAN");
	});

	it("copies the branch from the branch menu with C", async () => {
		renderHeader();
		fireEvent.contextMenu(screen.getByText("fix-login"));
		const copy = await screen.findByRole("menuitem", { name: /Copy/ });
		fireEvent.keyDown(copy, { key: "c" });
		await waitFor(() => expect(state.copyText).toHaveBeenCalledWith("fix-login"));
	});

	it("renames the branch from the branch menu with R", async () => {
		renderHeader();
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
		renderHeader();
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
		renderHeader();
		fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
		fireEvent.click(await screen.findByRole("option", { name: /develop/ }));
		await waitFor(() => expect(state.setTargetBranch).toHaveBeenCalledWith(workspaceId, "develop"));
	});

	it("says an archived workspace's target branch cannot change", async () => {
		state.workspace = { state: "ready", data: workspace({ state: "archived" }) };
		renderHeader();
		fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
		expect(
			await screen.findByText("Target branch cannot be changed for archived workspaces"),
		).toBeTruthy();
		expect(screen.queryByRole("option")).toBeNull();
	});

	it("shows the loading state", () => {
		state.workspace = { state: "loading" };
		renderHeader();
		expect(screen.getByRole("status", { name: "Loading workspace" })).toBeTruthy();
	});

	it("shows the load error", () => {
		state.workspace = { state: "error", error: { code: "db", message: "The database is busy." } };
		renderHeader();
		expect(screen.getByRole("alert").textContent).toContain("The database is busy.");
	});

	it("hides Open in for an archived workspace", () => {
		state.workspace = { state: "ready", data: workspace({ state: "archived" }) };
		renderHeader();
		expect(screen.queryByRole("button", { name: "Open in" })).toBeNull();
	});
});
