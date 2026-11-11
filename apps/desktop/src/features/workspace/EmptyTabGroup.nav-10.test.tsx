/**
 * @feature NAV-10 Empty tab group
 * Owns: tests for starting the first tab from the empty centre.
 * Test first: Clicking 'New chat' calls sessions.create and sets tab=session with the new id in the URL.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Workspace } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	createFromDefaults: vi.fn(),
	createTerminal: vi.fn(),
	workspace: { state: "ready", data: { port: 3000 } } as Loadable<Workspace>,
	sessions: { state: "ready", data: [] },
	settings: {} as Record<string, unknown>,
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ terminals: { create: state.createTerminal } }),
	useWorkspace: () => state.workspace,
	useSessions: () => state.sessions,
	useSetting: (key: string) => state.settings[key] ?? false,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { sessions: { createFromDefaults: state.createFromDefaults } } }),
}));

const { EmptyTabGroup } = await import("./EmptyTabGroup.tsx");

const workspaceId = "w1" as WorkspaceId;

beforeEach(() => {
	state.settings = {};
	state.workspace = { state: "ready", data: { port: 3000 } } as Loadable<Workspace>;
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
		await waitFor(() =>
			expect(state.createTerminal).toHaveBeenCalledWith(workspaceId, { placement: "centre" }),
		);
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "terminal", terminalId: "t1" });
	});

	it("uses the big-terminal preset like the '+' menu", async () => {
		state.settings = {
			experimental_big_terminal_mode: true,
			big_terminal_preset: "npm run dev",
		};
		state.createTerminal.mockResolvedValue({ ok: true, value: { id: "t2" } });
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "Local terminal" }));
		await waitFor(() =>
			expect(state.createTerminal).toHaveBeenCalledWith(workspaceId, {
				placement: "centre",
				command: "npm run dev",
			}),
		);
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

	it("disables Browser until the workspace has a port", () => {
		state.workspace = { state: "ready", data: { port: 0 } } as Loadable<Workspace>;
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={vi.fn()} />);
		expect((screen.getByRole("button", { name: "Browser" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});
