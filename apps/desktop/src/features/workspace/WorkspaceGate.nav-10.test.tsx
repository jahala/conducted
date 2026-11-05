/**
 * @feature NAV-10 Workspace gate
 * Owns: tests for what the centre shows before any tab.
 * Test first: an archived workspace shows "This workspace is archived"; a ready one renders its
 * children.
 */
import { cleanup, render, screen } from "@testing-library/react";
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

	it("explains a workspace that cannot be opened", () => {
		state.workspace = {
			state: "error",
			error: { code: "workspace_unknown", message: "Workspace not found" },
		};
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.getByText("Error loading workspace")).toBeTruthy();
		expect(screen.getByText("Workspace not found")).toBeTruthy();
	});
});
