/**
 * @feature NAV-10 Empty tab group
 * Owns: tests for starting the first tab from the empty centre.
 * Test first: Clicking 'New chat' calls sessions.create and sets tab=session with the new id in the URL.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import type { Loadable } from "../../core/api.ts";
import type { Workspace } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	createFromDefaults: vi.fn(),
	createTerminal: vi.fn(),
	workspace: { state: "ready", data: { port: 3000 } } as Loadable<Workspace>,
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ terminals: { create: state.createTerminal } }),
	useWorkspace: () => state.workspace,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { sessions: { createFromDefaults: state.createFromDefaults } } }),
}));

const { EmptyTabGroup } = await import("./EmptyTabGroup.tsx");

const workspaceId = "w1" as WorkspaceId;

beforeEach(() => {
	state.createFromDefaults.mockReset();
	state.createTerminal.mockReset();
});

afterEach(cleanup);

describe("NAV-10 EmptyTabGroup", () => {
	it("starts a chat and opens its tab", async () => {
		state.createFromDefaults.mockResolvedValue({ ok: true, value: { id: "s1" } });
		const onSearchChange = vi.fn();
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={onSearchChange} />);
		fireEvent.click(screen.getByRole("button", { name: "New chat" }));
		await waitFor(() => expect(state.createFromDefaults).toHaveBeenCalledWith(workspaceId));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "s1" });
	});

	it("opens a terminal and shows its tab", async () => {
		state.createTerminal.mockResolvedValue({ ok: true, value: { id: "t1" } });
		const onSearchChange = vi.fn();
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={onSearchChange} />);
		fireEvent.click(screen.getByRole("button", { name: "Local terminal" }));
		await waitFor(() => expect(state.createTerminal).toHaveBeenCalledWith(workspaceId));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "terminal", terminalId: "t1" });
	});

	it("opens the browser tab on the workspace port", () => {
		const onSearchChange = vi.fn();
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={onSearchChange} />);
		fireEvent.click(screen.getByRole("button", { name: "Browser" }));
		expect(onSearchChange).toHaveBeenCalledWith({
			tab: "browser",
			browserUrl: "http://localhost:3000",
		});
	});
});
