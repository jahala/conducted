/**
 * @feature NAV-10 Workspace header
 * Owns: tests for the breadcrumb, the name, the folder chip, the branch menu, the rename and target
 * branch dialogs, the actions button, loading, error and archived states.
 * Test first: Renders the workspace name and the Open in menu; the toggle button reflects
 * rightPanelOpen.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
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
	useActions: () => ({
		app: { copyText: state.copyText },
		workspaces: { rename: state.rename, setTargetBranch: state.setTargetBranch },
		git: { renameBranch: state.renameBranch },
	}),
}));

vi.mock("./WorkspaceActionsMenu.tsx", () => ({
	WorkspaceActionsMenu: () => <button type="button">Workspace actions</button>,
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
	it("shows the repository, branch, workspace name and Open in", () => {
		renderHeader();
		expect(screen.getByText("Conducted")).toBeTruthy();
		expect(screen.getByText("fix-login")).toBeTruthy();
		expect(screen.getByText("Fix login")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Open in" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Workspace actions" })).toBeTruthy();
	});

	it("names the workspace by its folder when it has no name, PR title or branch", () => {
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

	it("copies the folder path from the directory chip", async () => {
		renderHeader();
		fireEvent.click(screen.getByTitle("Copy folder path"));
		await waitFor(() =>
			expect(state.copyText).toHaveBeenCalledWith("/code/workspaces/quiet-meadow"),
		);
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

	it("renames the workspace from the pencil button", async () => {
		renderHeader();
		fireEvent.click(screen.getByRole("button", { name: "Rename workspace" }));
		const field = await screen.findByRole("textbox", { name: "Name" });
		expect((field as HTMLInputElement).value).toBe("Fix login");
		fireEvent.change(field, { target: { value: "Better name" } });
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		await waitFor(() => expect(state.rename).toHaveBeenCalledWith(workspaceId, "Better name"));
	});

	it("changes the target branch from the shared dialog", async () => {
		renderHeader();
		fireEvent.click(screen.getByRole("button", { name: /Target branch/ }));
		const field = await screen.findByRole("textbox", { name: "Branch" });
		fireEvent.change(field, { target: { value: "develop" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(state.setTargetBranch).toHaveBeenCalledWith(workspaceId, "develop"));
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
