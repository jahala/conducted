/**
 * @feature NAV-10 Tab strip
 * Owns: tests for closing the active tab, closing another tab, the tab limit, the failure and
 * loading cards, Retry, the status icon, the comment title, the drag ghost, excluded split tabs and
 * the shortcut handlers.
 * Test first: Closing the active middle tab selects the tab to its right; at the limit the '+'
 * menu is disabled.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CommandRegistryProvider, createCommandRegistry } from "../../app/command-dispatcher.ts";
import type { Loadable } from "../../core/api.ts";
import type { DiffComment, Session } from "../../core/model.ts";
import type { WorkspaceSearch } from "./workspace-search.ts";

const state = vi.hoisted(() => {
	const sessionsSnapshot = {
		liveStates: {} as Record<string, unknown>,
		cancelling: {} as Record<string, boolean>,
	};
	const sessionsStore = {
		getState: () => sessionsSnapshot,
		getInitialState: () => sessionsSnapshot,
		subscribe: () => () => {},
		setState: () => {},
	};
	const reviewSnapshot = { byWorkspace: {} as Record<string, DiffComment[]> };
	const reviewStore = {
		getState: () => reviewSnapshot,
		getInitialState: () => reviewSnapshot,
		subscribe: () => () => {},
		setState: () => {},
	};
	return {
		sessions: { state: "ready", data: [] } as Loadable<Session[]>,
		terminals: { state: "ready", data: [] } as unknown as Loadable<unknown[]>,
		workspace: {
			state: "ready",
			data: { prNumber: null, host: { kind: "local" } },
		} as unknown as Loadable<unknown>,
		freak: false,
		close: vi.fn(),
		closeTerminal: vi.fn(),
		reopen: vi.fn(),
		createTerminal: vi.fn(),
		createFromDefaults: vi.fn(),
		start: vi.fn(),
		loadWorkspace: vi.fn(),
		sessionsSnapshot,
		reviewSnapshot,
		sessionsStore,
		reviewStore,
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
	useTerminals: () => state.terminals,
	useWorkspace: () => state.workspace,
	useSetting: (key: string) => (key === "experimental_tab_freak_mode" ? state.freak : false),
	useLiveShortcut: () => null,
	useActions: () => ({
		sessions: { close: state.close, reopen: state.reopen },
		terminals: { close: state.closeTerminal, create: state.createTerminal },
	}),
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({
		services: {
			sessions: {
				store: state.sessionsStore,
				start: state.start,
				createFromDefaults: state.createFromDefaults,
				create: vi.fn(),
			},
			review: { store: state.reviewStore },
			terminals: { loadWorkspace: state.loadWorkspace },
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

const renderStrip = ({
	search = {},
	onSearchChange = vi.fn(),
	excludeRefs,
	withRegistry = false,
}: {
	search?: WorkspaceSearch;
	onSearchChange?: (patch: Partial<WorkspaceSearch>) => void;
	excludeRefs?: ReadonlySet<string>;
	withRegistry?: boolean;
} = {}) => {
	const registry = createCommandRegistry();
	const element = createElement(TabStrip, {
		workspaceId,
		search,
		onSearchChange,
		excludeRefs,
	});
	const rendered = render(
		withRegistry ? createElement(CommandRegistryProvider, { registry }, element) : element,
	);
	return { ...rendered, registry, onSearchChange };
};

beforeEach(() => {
	state.sessions = { state: "ready", data: [] };
	state.terminals = { state: "ready", data: [] };
	state.workspace = { state: "ready", data: { prNumber: null, host: { kind: "local" } } };
	state.freak = false;
	state.sessionsSnapshot.liveStates = {};
	state.sessionsSnapshot.cancelling = {};
	state.reviewSnapshot.byWorkspace = {};
	for (const fn of [
		state.close,
		state.closeTerminal,
		state.reopen,
		state.createTerminal,
		state.createFromDefaults,
		state.start,
		state.loadWorkspace,
	]) {
		fn.mockReset();
		fn.mockResolvedValue({ ok: true, value: undefined });
	}
});

// React warns about a missing list key once per file, so every test checks for it, not one.
let consoleErrors: MockInstance<typeof console.error>;
beforeEach(() => {
	consoleErrors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	const keyWarnings = consoleErrors.mock.calls.filter((call) => String(call[0]).includes("key"));
	consoleErrors.mockRestore();
	cleanup();
	expect(keyWarnings).toEqual([]);
});

describe("NAV-10 TabStrip", () => {
	it("selects the tab to its right when the active middle tab closes", async () => {
		state.sessions = {
			state: "ready",
			data: [session("one", "One"), session("two", "Two"), session("three", "Three")],
		};
		const onSearchChange = vi.fn();
		renderStrip({ search: { tab: "session", sessionId: "two" }, onSearchChange });
		fireEvent.click(screen.getByRole("button", { name: "Close Two" }));
		await waitFor(() => expect(state.close).toHaveBeenCalledWith("two"));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "three" });
	});

	it("keeps the current tab when another tab closes", async () => {
		state.sessions = {
			state: "ready",
			data: [session("one", "One"), session("two", "Two"), session("three", "Three")],
		};
		const onSearchChange = vi.fn();
		renderStrip({ search: { tab: "session", sessionId: "one" }, onSearchChange });
		fireEvent.click(screen.getByRole("button", { name: "Close Two" }));
		await waitFor(() => expect(state.close).toHaveBeenCalledWith("two"));
		expect(onSearchChange).not.toHaveBeenCalled();
	});

	it("leaves a split pane's tab out of the main strip", () => {
		state.sessions = { state: "ready", data: [session("one", "One"), session("two", "Two")] };
		renderStrip({ excludeRefs: new Set(["session:two"]) });
		expect(screen.getByRole("tab", { name: "One" })).toBeTruthy();
		expect(screen.queryByRole("tab", { name: "Two" })).toBeNull();
	});

	it("closes a terminal from its close button", async () => {
		state.terminals = {
			state: "ready",
			data: [{ id: "t1", kind: "terminal", title: "Terminal 1", placement: "centre" }],
		};
		renderStrip({ search: { tab: "terminal", terminalId: "t1" } });
		fireEvent.click(screen.getByRole("button", { name: "Close Terminal 1" }));
		await waitFor(() => expect(state.closeTerminal).toHaveBeenCalledWith("t1"));
	});

	it("mounts the chat tab menu on a chat tab", async () => {
		state.sessions = { state: "ready", data: [session("one", "One")] };
		renderStrip();
		fireEvent.contextMenu(screen.getByRole("tab", { name: "One" }));
		expect(await screen.findByRole("menuitem", { name: "Rename chat" })).toBeTruthy();
	});

	it("disables the new tab menu at the limit", () => {
		state.sessions = {
			state: "ready",
			data: ["a", "b", "c", "d", "e"].map((id) => session(id, id)),
		};
		renderStrip();
		expect(screen.getByText("at the tab limit")).toBeTruthy();
	});

	it("raises the limit to ten with Tab Freak Mode", () => {
		state.freak = true;
		state.sessions = {
			state: "ready",
			data: ["a", "b", "c", "d", "e"].map((id) => session(id, id)),
		};
		renderStrip();
		expect(screen.getByText("under the tab limit")).toBeTruthy();
	});

	it("stops ten tabs at the raised limit", () => {
		state.freak = true;
		state.sessions = {
			state: "ready",
			data: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => session(id, id)),
		};
		renderStrip();
		expect(screen.getByText("at the tab limit")).toBeTruthy();
	});

	it("shows the failure card with Retry and retries the services", async () => {
		state.sessions = {
			state: "error",
			error: { code: "db", message: "The database is busy." },
		};
		renderStrip();
		expect(screen.getByText("Tabs failed to load")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(state.start).toHaveBeenCalled());
		await waitFor(() => expect(state.loadWorkspace).toHaveBeenCalledWith(workspaceId));
	});

	it("shows the loading state before any tab", () => {
		state.sessions = { state: "loading" };
		renderStrip();
		expect(screen.getByText("Loading tabs")).toBeTruthy();
	});

	it("shows the chat's status icon", () => {
		state.sessions = { state: "ready", data: [session("one", "One")] };
		state.sessionsSnapshot.liveStates = {
			one: { status: "working", backgroundTasks: [], openInteraction: undefined },
		};
		renderStrip({ search: { tab: "session", sessionId: "one" } });
		expect(screen.getByRole("status", { name: "Working…" })).toBeTruthy();
	});

	it("titles a comment tab with its author", () => {
		state.reviewSnapshot.byWorkspace = {
			w1: [
				{
					id: "c1",
					author: { kind: "github", name: "Ada", avatarUrl: null },
				} as DiffComment,
			],
		};
		renderStrip({ search: { tab: "comment", commentId: "c1" } });
		expect(screen.getByRole("tab", { name: "Comment by Ada" })).toBeTruthy();
	});

	it("sets a drag image when a tab starts dragging", () => {
		state.sessions = { state: "ready", data: [session("one", "One")] };
		renderStrip();
		const setDragImage = vi.fn();
		fireEvent.dragStart(screen.getByRole("tab", { name: "One" }), {
			dataTransfer: {
				setData: vi.fn(),
				effectAllowed: "",
				setDragImage,
				types: [],
			},
		});
		expect(setDragImage).toHaveBeenCalledTimes(1);
	});

	it("closes the active tab with Cmd+W", async () => {
		state.sessions = { state: "ready", data: [session("one", "One")] };
		const { registry } = renderStrip({
			search: { tab: "session", sessionId: "one" },
			withRegistry: true,
		});
		expect(registry.run("tab.close")).toBe(true);
		await waitFor(() => expect(state.close).toHaveBeenCalledWith("one"));
	});

	it("moves to the next and previous tab", () => {
		state.sessions = {
			state: "ready",
			data: [session("one", "One"), session("two", "Two")],
		};
		const onSearchChange = vi.fn();
		const { registry } = renderStrip({
			search: { tab: "session", sessionId: "one" },
			onSearchChange,
			withRegistry: true,
		});
		registry.run("tab.next");
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "two" });
		onSearchChange.mockClear();
		registry.run("tab.previous");
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "two" });
	});

	it("starts a chat with Cmd+T", async () => {
		state.createFromDefaults.mockResolvedValue({ ok: true, value: { id: "s9" } });
		const onSearchChange = vi.fn();
		const { registry } = renderStrip({ onSearchChange, withRegistry: true });
		expect(registry.run("chat.newTab")).toBe(true);
		await waitFor(() => expect(state.createFromDefaults).toHaveBeenCalledWith(workspaceId));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "s9" });
	});

	it("reopens the last closed chat with Cmd+Shift+T", async () => {
		state.sessions = { state: "ready", data: [session("one", "One")] };
		const onSearchChange = vi.fn();
		const { registry } = renderStrip({
			search: { tab: "session", sessionId: "one" },
			onSearchChange,
			withRegistry: true,
		});
		fireEvent.click(screen.getByRole("button", { name: "Close One" }));
		await waitFor(() => expect(onSearchChange).toHaveBeenCalled());
		registry.run("tab.reopenClosed");
		await waitFor(() => expect(state.reopen).toHaveBeenCalledWith("one"));
	});

	it("renders sessions, terminals and a file tab together", () => {
		state.sessions = { state: "ready", data: [session("one", "One")] };
		state.terminals = {
			state: "ready",
			data: [
				{ id: "t1", kind: "terminal", title: "Terminal 1", placement: "centre" },
				{ id: "t2", kind: "terminal", title: "Terminal 2", placement: "centre" },
			],
		};
		renderStrip({ search: { tab: "file", path: "a.ts" } });
		expect(screen.getAllByRole("tab")).toHaveLength(4);
	});

	it("closes the chat once when 'Close tab' is chosen from its menu", async () => {
		state.sessions = { state: "ready", data: [session("one", "One"), session("two", "Two")] };
		const onSearchChange = vi.fn();
		renderStrip({ search: { tab: "session", sessionId: "one" }, onSearchChange });
		fireEvent.contextMenu(screen.getByRole("tab", { name: "One" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: /Close tab/ }));
		await waitFor(() => expect(onSearchChange).toHaveBeenCalled());
		expect(state.close).toHaveBeenCalledTimes(1);
		expect(state.close).toHaveBeenCalledWith("one");
	});

	it("closes the other chats and keeps the chosen one with 'Close others'", async () => {
		state.sessions = {
			state: "ready",
			data: [session("one", "One"), session("two", "Two"), session("three", "Three")],
		};
		const onSearchChange = vi.fn();
		renderStrip({ search: { tab: "session", sessionId: "one" }, onSearchChange });
		fireEvent.contextMenu(screen.getByRole("tab", { name: "Two" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Close others" }));
		await waitFor(() => expect(state.close).toHaveBeenCalledTimes(2));
		expect(state.close.mock.calls.map((call) => call[0]).sort()).toEqual(["one", "three"]);
		await waitFor(() =>
			expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "two" }),
		);
	});

	it("disables 'Close others' when it is the only tab", async () => {
		state.sessions = { state: "ready", data: [session("one", "One")] };
		renderStrip({ search: { tab: "session", sessionId: "one" } });
		fireEvent.contextMenu(screen.getByRole("tab", { name: "One" }));
		const item = await screen.findByRole("menuitem", { name: "Close others" });
		expect(item.getAttribute("aria-disabled")).toBe("true");
	});
});
