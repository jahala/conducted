import type { SessionId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Session } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	open: { state: "loading" } as Loadable<Session[]>,
	closed: { state: "loading" } as Loadable<Session[]>,
	reopen: vi.fn(),
	createFromDefaults: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useSessions: () => state.open,
	useClosedSessions: () => state.closed,
	useActions: () => ({ sessions: { reopen: state.reopen } }),
	useWorkspace: () => ({ state: "ready", data: { port: 0 } }),
	useSetting: () => false,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { sessions: { createFromDefaults: state.createFromDefaults } } }),
}));

const { ChatHistoryButton } = await import("./ChatHistoryButton.tsx");

const workspaceId = "w1" as WorkspaceId;

const session = (id: string, over: Partial<Session> = {}): Session => ({
	id: id as SessionId,
	workspaceId,
	title: id,
	config: {
		agent: "claude",
		model: "default",
		effort: "high",
		fastMode: false,
		planMode: false,
		requireToolApproval: true,
		additionalDirectories: [],
		appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	},
	agentSessionId: null,
	forkResumeNativeMessageId: null,
	unreadCount: 0,
	contextUsedTokens: null,
	contextWindowTokens: null,
	queuePausedAt: null,
	closedAt: null,
	lastUserMessageAt: null,
	createdAt: 1000,
	updatedAt: 1000,
	...over,
});

const renderButton = () => {
	const onSearchChange = vi.fn();
	render(<ChatHistoryButton workspaceId={workspaceId} onSearchChange={onSearchChange} />);
	return onSearchChange;
};

const openHistory = async () => {
	const trigger = screen.getByRole("button", { name: "View chat history" });
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
	await screen.findByRole("menu");
};

beforeEach(() => {
	state.open = { state: "loading" };
	state.closed = { state: "loading" };
	state.reopen.mockReset();
	state.createFromDefaults.mockReset();
});

afterEach(cleanup);

describe("CHAT-01 chat history button", () => {
	it("is not drawn while the chats load", () => {
		renderButton();
		expect(screen.queryByRole("button", { name: "View chat history" })).toBeNull();
	});

	it("lists only the closed chats, newest first, each with its time", async () => {
		state.open = { state: "ready", data: [session("open")] };
		state.closed = {
			state: "ready",
			data: [
				session("older", { closedAt: 2000, updatedAt: Date.now() - 3 * 3_600_000 }),
				session("newer", { closedAt: 3000, updatedAt: Date.now() - 5 * 60_000 }),
			],
		};
		renderButton();
		await openHistory();
		const rows = await screen.findAllByRole("menuitem");
		expect(rows.map((row) => row.textContent)).toEqual(["newer5m ago", "older3h ago"]);
	});

	it("reopens a closed chat and opens its tab", async () => {
		state.open = { state: "ready", data: [] };
		state.closed = { state: "ready", data: [session("old", { closedAt: 2000 })] };
		state.reopen.mockResolvedValue({ ok: true, value: undefined });
		const onSearchChange = renderButton();
		await openHistory();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^old/ }));
		await waitFor(() => expect(state.reopen).toHaveBeenCalledWith("old"));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "old" });
	});

	it("leaves the open chats to the tab strip", async () => {
		state.open = { state: "ready", data: [session("open")] };
		state.closed = { state: "ready", data: [session("old", { closedAt: 2000 })] };
		renderButton();
		await openHistory();
		await screen.findByRole("menuitem", { name: /^old/ });
		expect(screen.queryByRole("menuitem", { name: /^open/ })).toBeNull();
		expect(state.reopen).not.toHaveBeenCalled();
	});

	it("searches the list by title", async () => {
		state.open = { state: "ready", data: [] };
		state.closed = {
			state: "ready",
			data: [session("Fix login", { closedAt: 2000 }), session("Update docs", { closedAt: 2000 })],
		};
		renderButton();
		await openHistory();
		fireEvent.change(await screen.findByRole("textbox", { name: "Search chats" }), {
			target: { value: "login" },
		});
		expect(screen.queryByRole("menuitem", { name: /^Update docs/ })).toBeNull();
		expect(screen.getByRole("menuitem", { name: /^Fix login/ })).toBeTruthy();
	});

	it("is not drawn when no chat of the workspace is closed, as in Conductor", () => {
		state.open = { state: "ready", data: [session("open")] };
		state.closed = { state: "ready", data: [] };
		renderButton();
		expect(screen.queryByRole("button", { name: "View chat history" })).toBeNull();
		expect(state.createFromDefaults).not.toHaveBeenCalled();
	});

	it("offers no New chat of its own: the tab strip's + starts chats", async () => {
		state.open = { state: "ready", data: [] };
		state.closed = { state: "ready", data: [session("old", { closedAt: 2000 })] };
		renderButton();
		await openHistory();
		await screen.findByRole("menuitem", { name: /^old/ });
		expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
		expect(screen.queryByText("No open chats")).toBeNull();
	});
});
