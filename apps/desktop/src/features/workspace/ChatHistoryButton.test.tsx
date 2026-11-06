import type { SessionId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Session } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";

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
	it("shows the loading state", async () => {
		renderButton();
		await openHistory();
		expect(await screen.findByText("Loading chats")).toBeTruthy();
	});

	it("shows 'No open chats' with New chat when everything is closed", async () => {
		state.open = { state: "ready", data: [] };
		state.closed = { state: "ready", data: [session("old", { closedAt: 2000 })] };
		renderButton();
		await openHistory();
		expect(await screen.findByText("No open chats")).toBeTruthy();
		expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
	});

	it("reopens a closed chat and opens its tab", async () => {
		state.open = { state: "ready", data: [] };
		state.closed = { state: "ready", data: [session("old", { closedAt: 2000 })] };
		state.reopen.mockResolvedValue({ ok: true, value: undefined });
		const onSearchChange = renderButton();
		await openHistory();
		fireEvent.click(await screen.findByRole("menuitem", { name: "old" }));
		await waitFor(() => expect(state.reopen).toHaveBeenCalledWith("old"));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "old" });
	});

	it("opens an open chat without reopening it", async () => {
		state.open = { state: "ready", data: [session("open")] };
		state.closed = { state: "ready", data: [] };
		const onSearchChange = renderButton();
		await openHistory();
		fireEvent.click(await screen.findByRole("menuitem", { name: "open" }));
		expect(state.reopen).not.toHaveBeenCalled();
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "open" });
	});

	it("searches the list by title", async () => {
		state.open = {
			state: "ready",
			data: [session("Fix login"), session("Update docs")],
		};
		state.closed = { state: "ready", data: [] };
		renderButton();
		await openHistory();
		fireEvent.change(await screen.findByRole("textbox", { name: "Search chats" }), {
			target: { value: "login" },
		});
		expect(screen.queryByRole("menuitem", { name: "Update docs" })).toBeNull();
		expect(screen.getByRole("menuitem", { name: "Fix login" })).toBeTruthy();
	});

	it("starts a new chat from the default config when the workspace has no chat", async () => {
		const created = session("new", { createdAt: 3000 });
		state.open = { state: "ready", data: [] };
		state.closed = { state: "ready", data: [] };
		state.createFromDefaults.mockResolvedValue({ ok: true, value: created });
		const onSearchChange = renderButton();
		await openHistory();
		const newChat = await screen.findByRole("button", { name: "New chat" });
		expect(newChat.hasAttribute("disabled")).toBe(false);
		fireEvent.click(newChat);
		await waitFor(() => expect(state.createFromDefaults).toHaveBeenCalledWith(workspaceId));
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "new" });
	});

	it("starts a new chat from the default config even when older chats exist", async () => {
		const created = session("new", { createdAt: 3000 });
		state.open = { state: "ready", data: [] };
		state.closed = { state: "ready", data: [session("old", { closedAt: 2000 })] };
		state.createFromDefaults.mockResolvedValue({ ok: true, value: created });
		renderButton();
		await openHistory();
		fireEvent.click(await screen.findByRole("button", { name: "New chat" }));
		await waitFor(() => expect(state.createFromDefaults).toHaveBeenCalledWith(workspaceId));
	});
});
