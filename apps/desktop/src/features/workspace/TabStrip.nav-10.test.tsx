/**
 * @feature NAV-10 Tab strip
 * Owns: tests for closing the active tab, the tab limit and the failure card.
 * Test first: Closing the active middle tab selects the tab to its right; at the limit the '+'
 * menu is disabled.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import type { Loadable } from "../../core/api.ts";
import type { Session } from "../../core/model.ts";

const state = vi.hoisted(() => {
	const snapshot = { liveStates: {} };
	const sessionsStore = {
		getState: () => snapshot,
		getInitialState: () => snapshot,
		subscribe: () => () => {},
		setState: () => {},
	};
	return {
		sessions: { state: "ready", data: [] } as Loadable<Session[]>,
		close: vi.fn(),
		closeTerminal: vi.fn(),
		store: sessionsStore,
	};
});

const session = (id: string, title: string): Session =>
	({
		id: id as SessionId,
		title,
		unreadCount: 0,
		closedAt: null,
		config: {},
	}) as Session;

vi.mock("../../core/hooks.ts", () => ({
	useSessions: () => state.sessions,
	useTerminals: () => ({ state: "ready", data: [] }),
	useWorkspace: () => ({ state: "ready", data: { prNumber: null } }),
	useSetting: () => false,
	useActions: () => ({
		sessions: { close: state.close, reopen: vi.fn() },
		terminals: { close: state.closeTerminal },
	}),
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({
		services: {
			sessions: { store: state.store, start: vi.fn(async () => ({ ok: true, value: undefined })) },
			terminals: {
				loadWorkspace: vi.fn(async () => ({ ok: true, value: undefined })),
			},
		},
	}),
}));

vi.mock("./NewTabMenu.tsx", () => ({
	NewTabMenu: ({ atTabLimit }: { atTabLimit: boolean }) => (
		<p>{atTabLimit ? "at the tab limit" : "under the tab limit"}</p>
	),
}));

vi.mock("./ChatHistoryButton.tsx", () => ({
	ChatHistoryButton: () => <p>chat history</p>,
}));

const { TabStrip } = await import("./TabStrip.tsx");

const workspaceId = "w1" as WorkspaceId;

beforeEach(() => {
	state.sessions = { state: "ready", data: [] };
	state.close.mockReset();
	state.close.mockResolvedValue({ ok: true, value: undefined });
	state.closeTerminal.mockReset();
});

afterEach(cleanup);

describe("NAV-10 TabStrip", () => {
	it("selects the tab to its right when the active middle tab closes", async () => {
		state.sessions = {
			state: "ready",
			data: [session("one", "One"), session("two", "Two"), session("three", "Three")],
		};
		const onSearchChange = vi.fn();
		render(
			<TabStrip
				workspaceId={workspaceId}
				search={{ tab: "session", sessionId: "two" }}
				onSearchChange={onSearchChange}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Close Two" }));
		await waitFor(() => expect(state.close).toHaveBeenCalledWith("two"));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "three" });
	});

	it("mounts the chat tab menu on a chat tab", async () => {
		state.sessions = { state: "ready", data: [session("one", "One")] };
		render(<TabStrip workspaceId={workspaceId} search={{}} onSearchChange={vi.fn()} />);
		fireEvent.contextMenu(screen.getByRole("tab", { name: "One" }));
		expect(await screen.findByRole("menuitem", { name: "Rename chat" })).toBeTruthy();
	});

	it("disables the new tab menu at the limit", () => {
		state.sessions = {
			state: "ready",
			data: ["a", "b", "c", "d", "e"].map((id) => session(id, id)),
		};
		render(<TabStrip workspaceId={workspaceId} search={{}} onSearchChange={vi.fn()} />);
		expect(screen.getByText("at the tab limit")).toBeTruthy();
	});

	it("shows the failure card with Retry when the tabs cannot load", () => {
		state.sessions = {
			state: "error",
			error: { code: "db", message: "The database is busy." },
		};
		render(<TabStrip workspaceId={workspaceId} search={{}} onSearchChange={vi.fn()} />);
		expect(screen.getByText("Tabs failed to load")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});
});
