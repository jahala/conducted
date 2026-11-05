/**
 * @feature NAV-10 Workspace gate
 * Owns: tests for what the centre shows before any tab.
 * Test first: an archived workspace shows "This workspace is archived"; a ready one renders its
 * children.
 */
import { appError } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import type { Loadable } from "../../core/api.ts";
import type { Workspace } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	workspace: { state: "loading" } as Loadable<Workspace>,
	unarchive: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useWorkspace: () => state.workspace,
	useActions: () => ({ workspaces: { unarchive: state.unarchive } }),
}));

const { WorkspaceGate } = await import("./WorkspaceGate.tsx");

const id = "w1" as Parameters<typeof WorkspaceGate>[0]["workspaceId"];

afterEach(cleanup);

describe("NAV-10 WorkspaceGate", () => {
	it("shows the archived notice and hides the tabs", () => {
		state.workspace = { state: "ready", data: { id, state: "archived" } as Workspace };
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.getByText("This workspace is archived")).toBeTruthy();
		expect(screen.queryByText("content")).toBeNull();
	});

	it("renders its children for a ready workspace", () => {
		state.workspace = { state: "ready", data: { id, state: "ready" } as Workspace };
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.getByText("content")).toBeTruthy();
	});

	it("explains a workspace id that matches no row", () => {
		state.workspace = {
			state: "error",
			error: appError("workspace_unknown", "That workspace no longer exists."),
		};
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.getByText("Workspace not found")).toBeTruthy();
		expect(screen.getByText(/may have been deleted/i)).toBeTruthy();
		expect(screen.queryByText("content")).toBeNull();
	});

	it("shows any other load error with its own message, not the not-found card", () => {
		state.workspace = { state: "error", error: appError("db", "The database is locked.") };
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.getByText("Error loading workspace")).toBeTruthy();
		expect(screen.getByText("The database is locked.")).toBeTruthy();
		expect(screen.queryByText("Workspace not found")).toBeNull();
	});

	it("unarchives from the notice", async () => {
		state.workspace = { state: "ready", data: { id, state: "archived" } as Workspace };
		state.unarchive.mockResolvedValue({ ok: true, value: undefined });
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
		await waitFor(() =>
			expect(state.unarchive).toHaveBeenCalledWith(id, {
				branchName: null,
				clearChats: false,
			}),
		);
	});
});
