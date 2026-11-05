/**
 * @feature NAV-10 Workspace actions menu
 * Owns: tests for the one workspace actions list.
 * Test first: Choosing Pin calls workspaces.setPinned(id, true); for a pinned workspace the item
 * reads Unpin.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import type { Loadable } from "../../core/api.ts";
import type { Session, Workspace } from "../../core/model.ts";

const state = vi.hoisted(() => {
	const snapshot = { sections: [] };
	const sectionsStore = {
		getState: () => snapshot,
		getInitialState: () => snapshot,
		subscribe: () => () => {},
		setState: () => {},
	};
	return {
		workspace: { state: "ready", data: { pinnedAt: null, state: "ready" } } as Loadable<Workspace>,
		sessions: { state: "ready", data: [] } as Loadable<Session[]>,
		setPinned: vi.fn(),
		sectionsStore,
	};
});

vi.mock("../../core/hooks.ts", () => ({
	useWorkspace: () => state.workspace,
	useSessions: () => state.sessions,
	useActions: () => ({
		workspaces: {
			setPinned: state.setPinned,
			markRead: vi.fn(),
			markUnread: vi.fn(),
			setKanbanStatus: vi.fn(),
			rename: vi.fn(),
			archive: vi.fn(),
			unarchive: vi.fn(),
		},
		sections: { place: vi.fn(), create: vi.fn() },
		app: { copyText: vi.fn() },
	}),
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { sections: { store: state.sectionsStore } } }),
}));

const { WorkspaceActionsMenu } = await import("./WorkspaceActionsMenu.tsx");

const workspaceId = "w1" as WorkspaceId;

const openMenu = async () => {
	render(
		<WorkspaceActionsMenu workspaceId={workspaceId} surface="dropdown">
			<button type="button">Actions</button>
		</WorkspaceActionsMenu>,
	);
	const trigger = screen.getByRole("button", { name: "Actions" });
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
	return screen.findByRole("menu");
};

beforeEach(() => {
	state.setPinned.mockReset();
	state.setPinned.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(cleanup);

describe("NAV-10 WorkspaceActionsMenu", () => {
	it("pins an unpinned workspace", async () => {
		state.workspace = { state: "ready", data: { pinnedAt: null, state: "ready" } as Workspace };
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Pin/ }));
		await waitFor(() => expect(state.setPinned).toHaveBeenCalledWith(workspaceId, true));
	});

	it("reads Unpin for a pinned workspace", async () => {
		state.workspace = { state: "ready", data: { pinnedAt: 10, state: "ready" } as Workspace };
		await openMenu();
		expect(await screen.findByRole("menuitem", { name: /^Unpin/ })).toBeTruthy();
	});

	it("offers Unarchive instead of Rename for an archived workspace", async () => {
		state.workspace = { state: "ready", data: { pinnedAt: null, state: "archived" } as Workspace };
		await openMenu();
		expect(await screen.findByRole("menuitem", { name: "Unarchive" })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
	});

	it("shows the status items", async () => {
		state.workspace = { state: "ready", data: { pinnedAt: null, state: "ready" } as Workspace };
		await openMenu();
		expect(screen.getByRole("menuitem", { name: "Set status" })).toBeTruthy();
	});
});
