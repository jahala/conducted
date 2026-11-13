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
	workspace: {
		state: "ready",
		data: { port: 3000, host: { kind: "local" } },
	} as Loadable<Workspace>,
	sessions: { state: "ready", data: [] } as Loadable<unknown[]>,
	settings: {} as Record<string, unknown>,
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ terminals: { create: state.createTerminal } }),
	useWorkspace: () => state.workspace,
	useSessions: () => state.sessions,
	useSetting: (key: string) => state.settings[key] ?? false,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({
		services: {
			sessions: { createFromDefaults: state.createFromDefaults },
			settings: { store: { getState: () => ({ loaded: true, warnings: [] }) } },
		},
	}),
}));

const { EmptyTabGroup } = await import("./EmptyTabGroup.tsx");

const workspaceId = "w1" as WorkspaceId;

beforeEach(() => {
	state.sessions = { state: "ready", data: [] };
	state.settings = {};
	state.workspace = {
		state: "ready",
		data: { port: 3000, host: { kind: "local" } },
	} as Loadable<Workspace>;
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
			big_terminal_preset: "gemini",
		};
		state.createTerminal.mockResolvedValue({ ok: true, value: { id: "t2" } });
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "Local terminal" }));
		await waitFor(() =>
			expect(state.createTerminal).toHaveBeenCalledWith(workspaceId, {
				placement: "centre",
				command: "gemini -y",
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
		state.workspace = {
			state: "ready",
			data: { port: 0, host: { kind: "local" } },
		} as Loadable<Workspace>;
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={vi.fn()} />);
		expect((screen.getByRole("button", { name: "Browser" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});

describe("CHAT-01 a cloud workspace with no open chat (renderApp @2093263, @2093709)", () => {
	const cloud = { port: 0, host: { kind: "cloud" }, state: "ready" } as unknown as Workspace;

	it("says No open chats and offers New chat, which starts one", async () => {
		state.workspace = { state: "ready", data: cloud };
		state.sessions = { state: "ready", data: [] };
		state.createFromDefaults.mockResolvedValue({ ok: true, value: { id: "s1" } });
		const onSearchChange = vi.fn();
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={onSearchChange} />);
		expect(screen.getByText("No open chats")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Local terminal" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "New chat" }));
		await waitFor(() => expect(state.createFromDefaults).toHaveBeenCalledWith(workspaceId));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "s1" });
	});

	it("says Loading chats while the workspace's chats load", () => {
		state.workspace = { state: "ready", data: cloud };
		state.sessions = { state: "loading" };
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={vi.fn()} />);
		expect(screen.getByText("Loading chats")).toBeTruthy();
	});

	it("offers no New chat in an archived cloud workspace", () => {
		state.workspace = {
			state: "ready",
			data: { ...cloud, state: "archived" } as Workspace,
		};
		state.sessions = { state: "ready", data: [] };
		render(<EmptyTabGroup workspaceId={workspaceId} onSearchChange={vi.fn()} />);
		expect(screen.getByText("No open chats")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
	});
});
