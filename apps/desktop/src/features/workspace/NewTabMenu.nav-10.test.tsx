/**
 * @feature NAV-10 New tab menu
 * Owns: tests for starting a chat or terminal from the '+' menu.
 * Test first: Choosing 'Local terminal' calls terminals.create and sets the terminal tab in the URL.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Session, Workspace } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>,
	sessions: { state: "ready", data: [] } as Loadable<Session[]>,
	create: vi.fn(),
	createFromDefaults: vi.fn(),
	createTerminal: vi.fn(),
	workspace: { state: "ready", data: { port: 5173 } } as Loadable<Workspace>,
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ terminals: { create: state.createTerminal } }),
	useSessions: () => state.sessions,
	useWorkspace: () => state.workspace,
	useSetting: (key: string) => state.settings[key] ?? false,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({
		services: {
			sessions: { create: state.create, createFromDefaults: state.createFromDefaults },
			settings: { store: { getState: () => ({ loaded: true, warnings: [] }) } },
		},
	}),
}));

const { NewTabMenu } = await import("./NewTabMenu.tsx");

const workspaceId = "w1" as WorkspaceId;

const openMenu = async () => {
	render(<NewTabMenu workspaceId={workspaceId} atTabLimit={false} onSearchChange={vi.fn()} />);
	const trigger = screen.getByRole("button", { name: "New tab" });
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
	return screen.findByRole("menu");
};

beforeEach(() => {
	state.settings = {};
	state.sessions = { state: "ready", data: [] };
	state.create.mockReset();
	state.createFromDefaults.mockReset();
	state.createTerminal.mockReset();
});

afterEach(cleanup);

describe("NAV-10 NewTabMenu", () => {
	it("opens a local terminal and shows it", async () => {
		state.createTerminal.mockResolvedValue({ ok: true, value: { id: "t1" } });
		const onSearchChange = vi.fn();
		render(
			<NewTabMenu workspaceId={workspaceId} atTabLimit={false} onSearchChange={onSearchChange} />,
		);
		const trigger = screen.getByRole("button", { name: "New tab" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Local terminal" }));
		await waitFor(() =>
			expect(state.createTerminal).toHaveBeenCalledWith(workspaceId, { placement: "centre" }),
		);
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "terminal", terminalId: "t1" });
	});

	it("starts a big terminal with its startup command", async () => {
		state.settings = {
			experimental_big_terminal_mode: true,
			big_terminal_preset: "gemini",
		};
		state.createTerminal.mockResolvedValue({ ok: true, value: { id: "t2" } });
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Local terminal" }));
		await waitFor(() =>
			expect(state.createTerminal).toHaveBeenCalledWith(workspaceId, {
				placement: "centre",
				command: "gemini -y",
			}),
		);
	});

	it("disables its items at the tab limit", async () => {
		render(<NewTabMenu workspaceId={workspaceId} atTabLimit onSearchChange={vi.fn()} />);
		const trigger = screen.getByRole("button", { name: "New tab" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		const item = await screen.findByRole("menuitem", { name: "Local terminal" });
		expect(item.getAttribute("aria-disabled")).toBe("true");
		expect(screen.getByText("Close a tab before opening another.")).toBeTruthy();
	});

	it("disables Browser until the workspace has a port", async () => {
		state.workspace = { state: "ready", data: { port: 0 } } as Loadable<Workspace>;
		await openMenu();
		const item = await screen.findByRole("menuitem", { name: "Browser" });
		expect(item.getAttribute("aria-disabled")).toBe("true");
	});

	it("starts a chat from the recent chat's config when asked for the same files", async () => {
		state.sessions = {
			state: "ready",
			data: [{ id: "s1", config: { agent: "claude" } } as Session],
		};
		state.create.mockResolvedValue({ ok: true, value: { id: "s2" } });
		const onSearchChange = vi.fn();
		render(
			<NewTabMenu workspaceId={workspaceId} atTabLimit={false} onSearchChange={onSearchChange} />,
		);
		const trigger = screen.getByRole("button", { name: "New tab" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "New chat, same files" }));
		await waitFor(() =>
			expect(state.create).toHaveBeenCalledWith(workspaceId, { agent: "claude" }),
		);
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "s2" });
	});
});
