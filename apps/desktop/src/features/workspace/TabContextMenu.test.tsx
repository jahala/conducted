import type { SessionId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";

const state = vi.hoisted(() => ({
	rename: vi.fn(),
	close: vi.fn(),
	copyText: vi.fn(),
	markRead: vi.fn(),
	markUnread: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useLiveShortcut: () => null,
	useActions: () => ({
		sessions: {
			rename: state.rename,
			close: state.close,
			markRead: state.markRead,
			markUnread: state.markUnread,
		},
		app: { copyText: state.copyText },
	}),
}));

const { TabContextMenu } = await import("./TabContextMenu.tsx");

const sessionId = "s1" as SessionId;
const workspaceId = "w1" as WorkspaceId;

const chat = (over: Partial<Session> = {}): Session => ({
	id: sessionId,
	workspaceId,
	title: "Fix login",
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

const openMenu = async (props: Partial<Parameters<typeof TabContextMenu>[0]> = {}) => {
	render(
		<TabContextMenu sessionId={sessionId} session={chat()} workspaceId={workspaceId} {...props}>
			<div>Chat tab</div>
		</TabContextMenu>,
	);
	fireEvent.contextMenu(screen.getByText("Chat tab"));
	return screen.findByRole("menu");
};

beforeEach(() => {
	for (const fn of Object.values(state)) fn.mockReset();
	state.rename.mockResolvedValue({ ok: true, value: undefined });
	state.close.mockResolvedValue({ ok: true, value: undefined });
	state.copyText.mockResolvedValue({ ok: true, value: undefined });
	state.markRead.mockResolvedValue({ ok: true, value: undefined });
	state.markUnread.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(cleanup);

describe("CHAT-01 chat tab context menu", () => {
	it("keeps the transcript items disabled until CHAT-17 builds them", async () => {
		await openMenu();
		expect(
			(await screen.findByRole("menuitem", { name: /Copy concise transcript/ })).getAttribute(
				"aria-disabled",
			),
		).toBe("true");
		expect(
			screen.getByRole("menuitem", { name: /Copy full transcript/ }).getAttribute("aria-disabled"),
		).toBe("true");
	});

	it("marks the chat read or unread from the menu", async () => {
		await openMenu({ session: chat({ unreadCount: 2 }) });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as read" }));
		await waitFor(() => expect(state.markRead).toHaveBeenCalledWith(sessionId));
		cleanup();

		await openMenu({ session: chat({ unreadCount: 0 }) });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as unread" }));
		await waitFor(() => expect(state.markUnread).toHaveBeenCalledWith(sessionId));
	});

	it("renames the chat", async () => {
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Rename chat" }));
		const field = await screen.findByRole("textbox", { name: "Name" });
		fireEvent.change(field, { target: { value: "New name" } });
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		await waitFor(() => expect(state.rename).toHaveBeenCalledWith(sessionId, "New name"));
	});

	it("copies a deep link to the chat", async () => {
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
		await waitFor(() =>
			expect(state.copyText).toHaveBeenCalledWith("conducted://workspace?id=w1&session=s1"),
		);
	});

	it("reports 'Close tab' to the tab strip, which closes the chat", async () => {
		const onClose = vi.fn();
		await openMenu({ onClose });
		fireEvent.click(await screen.findByRole("menuitem", { name: /Close tab/ }));
		expect(onClose).toHaveBeenCalledTimes(1);
		// The strip closes the chat; closing here too would close it twice.
		expect(state.close).not.toHaveBeenCalled();
	});

	it("closes the other tabs", async () => {
		const onCloseOthers = vi.fn();
		await openMenu({ onCloseOthers });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Close others" }));
		expect(onCloseOthers).toHaveBeenCalledTimes(1);
	});
});
