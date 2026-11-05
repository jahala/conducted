/**
 * @feature NAV-10 Workspace header
 * Owns: tests for the breadcrumb, the name, the folder chip and the right panel toggle.
 * Test first: Renders the workspace name and the Open in menu; the toggle button reflects
 * rightPanelOpen.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
}));

vi.mock("../../core/hooks.ts", () => ({
	useWorkspace: () => state.workspace,
	useRepos: () => state.repos,
	useActions: () => ({
		app: { copyText: state.copyText },
		workspaces: { rename: vi.fn(), setTargetBranch: vi.fn() },
		git: { renameBranch: vi.fn() },
	}),
}));

vi.mock("./WorkspaceActionsMenu.tsx", () => ({
	WorkspaceActionsMenu: () => <button type="button">Workspace actions</button>,
}));

const { WorkspaceHeader } = await import("./WorkspaceHeader.tsx");

const workspaceId = "w1" as WorkspaceId;
const repoId = "r1" as RepoId;

afterEach(cleanup);

describe("NAV-10 WorkspaceHeader", () => {
	it("shows the repository, branch, workspace name and Open in", () => {
		render(
			<WorkspaceHeader
				repoId={repoId}
				workspaceId={workspaceId}
				controls={{ rightPanelOpen: true, toggleRightPanel: vi.fn() }}
			/>,
		);
		expect(screen.getByText("Conducted")).toBeTruthy();
		expect(screen.getByText("fix-login")).toBeTruthy();
		expect(screen.getByText("Fix login")).toBeTruthy();
		expect(screen.getByText(/Open in/)).toBeTruthy();
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
		state.copyText.mockResolvedValue({ ok: true, value: undefined });
		render(
			<WorkspaceHeader
				repoId={repoId}
				workspaceId={workspaceId}
				controls={{ rightPanelOpen: true, toggleRightPanel: vi.fn() }}
			/>,
		);
		fireEvent.click(screen.getByTitle("Copy folder path"));
		await waitFor(() =>
			expect(state.copyText).toHaveBeenCalledWith("/code/workspaces/quiet-meadow"),
		);
	});
});
