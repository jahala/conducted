/**
 * @feature CHAT-06 Chat tab
 * Owns: tests of the chat pane over the real container and its real children (message list, dock, composer and
 * the rest). The pane's own work is the effect that records the chat on screen and marks the workspace read.
 * Behaviour: ui-map.md 3.3 (chat view), 4 (opening a workspace clears its unread chats, except chats that still
 * wait for the user).
 * Test first: the pane lays out the message list, dock, progress, queue and composer for a seeded chat.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import {
	appError,
	err,
	type InteractionId,
	type MessageId,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { ChatPane } from "./ChatPane.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
});

/** The pane with a button that opens another chat in the same place, the way a tab switch does. */
function Harness({
	workspaceId,
	first,
	second,
}: {
	workspaceId: WorkspaceId;
	first: SessionId;
	second: SessionId;
}) {
	const [sessionId, setSessionId] = useState(first);
	return (
		<>
			<button type="button" onClick={() => setSessionId(second)}>
				Open the other chat
			</button>
			<ChatPane workspaceId={workspaceId} sessionId={sessionId} />
			<Toaster />
		</>
	);
}

async function mount(
	test: ReturnType<typeof createTestContainer>,
	workspaceId: WorkspaceId,
	first: SessionId,
	second: SessionId,
) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <Harness workspaceId={workspaceId} first={first} second={second} />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	const view = render(
		<ServicesProvider container={test.container}>
			<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
				<RouterProvider router={router} />
			</VirtuosoMockContext.Provider>
		</ServicesProvider>,
	);
	await router.load();
	return Object.assign(view, { router });
}

const unreadOf = (
	test: ReturnType<typeof createTestContainer>,
	id: SessionId,
): number | undefined =>
	test.container.services.sessions.store.getState().sessions[id]?.unreadCount;

describe("CHAT-06 chat pane", () => {
	it("lays out the message list, dock, progress, queue and composer for a chat", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const other = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.start());

			const { container } = await mount(test, workspace.id, chat.id, other.id);

			for (const region of ["messages", "agent-request", "progress", "queue", "composer"]) {
				expect(container.querySelector(`[data-region="${region}"]`)).toBeTruthy();
			}
			// The real message list answers for an empty chat, and the real composer offers to send.
			const messages = container.querySelector<HTMLElement>('[data-region="messages"]');
			const composer = container.querySelector<HTMLElement>('[data-region="composer"]');
			if (messages === null || composer === null) throw new Error("The pane has no regions.");
			expect(await within(messages).findByText("No messages yet")).toBeTruthy();
			expect(await within(composer).findByRole("button", { name: "Send message" })).toBeTruthy();
			// A part that crashed would show its boundary card instead of its content.
			expect(screen.queryByText("This part failed to load.")).toBeNull();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("records the chat on screen, clears the other chats' unread counts and keeps a waiting chat's", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const sessions = test.container.services.sessions;
			const current = must(await sessions.create(workspace.id, CONFIG));
			const sibling = must(await sessions.create(workspace.id, CONFIG));
			const waiting = must(await sessions.create(workspace.id, CONFIG));
			must(await sessions.start());
			must(await sessions.markUnread(current.id));
			must(await sessions.markUnread(sibling.id));
			must(await sessions.markUnread(waiting.id));
			must(
				await sessions.applyLiveState(waiting.id, {
					status: "idle",
					pendingSteerIds: [],
					backgroundTasks: [],
					fastModeAvailable: true,
					openInteraction: {
						interactionId: "i-1" as InteractionId,
						interaction: {
							kind: "question",
							questions: [{ question: "Continue?", options: [], multiSelect: false }],
						},
						since: 1000,
					},
				}),
			);

			const view = await mount(test, workspace.id, current.id, sibling.id);

			await waitFor(() => expect(unreadOf(test, sibling.id)).toBe(0));
			expect(unreadOf(test, current.id)).toBe(0);
			expect(unreadOf(test, waiting.id)).toBe(1);
			expect(sessions.store.getState().viewingSessionId).toBe(current.id);

			view.unmount();
			expect(sessions.store.getState().viewingSessionId).toBeNull();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("records the new chat when the tab switches to another one", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const sessions = test.container.services.sessions;
			const first = must(await sessions.create(workspace.id, CONFIG));
			const second = must(await sessions.create(workspace.id, CONFIG));
			must(await sessions.start());
			await mount(test, workspace.id, first.id, second.id);
			await waitFor(() => expect(sessions.store.getState().viewingSessionId).toBe(first.id));

			fireEvent.click(screen.getByRole("button", { name: "Open the other chat" }));

			await waitFor(() => expect(sessions.store.getState().viewingSessionId).toBe(second.id));
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("leaves the chat another pane recorded since when it closes", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const sessions = test.container.services.sessions;
			const first = must(await sessions.create(workspace.id, CONFIG));
			const second = must(await sessions.create(workspace.id, CONFIG));
			must(await sessions.start());
			const view = await mount(test, workspace.id, first.id, second.id);
			await waitFor(() => expect(sessions.store.getState().viewingSessionId).toBe(first.id));

			// A split pane opens the second chat beside this one, then this pane closes.
			sessions.setViewing(second.id);
			view.unmount();

			expect(sessions.store.getState().viewingSessionId).toBe(second.id);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("tells the user when the workspace could not be marked read", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const other = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.start());
			vi.spyOn(test.container.services.sessions, "markAllRead").mockResolvedValue(
				err(appError("mark_read_failed", "The database is busy.")),
			);

			await mount(test, workspace.id, chat.id, other.id);

			expect(await screen.findByText("Couldn't mark the workspace as read")).toBeTruthy();
			expect(screen.getByText("The database is busy.")).toBeTruthy();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});

/** Stores the events of one finished turn that changed two files, the way the ingest path does. */
function feedFinishedTurn(
	test: ReturnType<typeof createTestContainer>,
	sessionId: SessionId,
	turnId: TurnId,
): void {
	const base = { at: 1_700_000_000_000, turnId };
	const events = [
		{
			...base,
			eventId: "e1",
			type: "user_message",
			messageId: "m1",
			text: "Add the helper",
			attachmentPaths: [],
			delivery: "new_turn",
			config: CONFIG,
		},
		{ ...base, eventId: "e2", type: "checkpoint", phase: "start", checkpointId: "c1" },
		{
			...base,
			eventId: "e3",
			type: "checkpoint",
			phase: "end",
			checkpointId: "c2",
			changes: [
				{ path: "src/helper.ts", status: "added", linesAdded: 12, linesRemoved: 0, binary: false },
				{ path: "src/index.ts", status: "modified", linesAdded: 1, linesRemoved: 1, binary: false },
			],
		},
		{ ...base, eventId: "e4", type: "turn_ended", outcome: "success" },
	] as SessionEvent[];
	for (const [idx, event] of events.entries()) {
		test.container.services.sessions.applyStoredEvent(sessionId, idx, event, event.at);
	}
}

describe("REV-09 files changed under a turn", () => {
	it("lists the files a finished turn changed and opens that turn's diff in the Changes tab", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const sessions = test.container.services.sessions;
			const chat = must(await sessions.create(workspace.id, CONFIG));
			const other = must(await sessions.create(workspace.id, CONFIG));
			must(await sessions.start());
			const turnId = "turn-1" as TurnId;
			feedFinishedTurn(test, chat.id, turnId);

			const { router } = await mount(test, workspace.id, chat.id, other.id);

			// Conductor lists a turn's files as chips with their own names in the turn's footer row.
			expect(
				await screen.findByRole("region", { name: "Files changed in this turn" }),
			).toBeTruthy();
			expect(screen.getByText("helper.ts")).toBeTruthy();
			expect(screen.getByText("index.ts")).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Open diff" }));

			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					gitTab: "changes",
					scope: `turn:${chat.id}:${turnId}`,
				}),
			);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});

describe("CHAT-02 messages that were not sent", () => {
	const failedSend = (text: string, reason: string) => ({
		messageId: "m-failed" as MessageId,
		turnId: "t-failed" as TurnId,
		text,
		attachmentPaths: [],
		at: 1_700_000_000_000,
		delivery: "new_turn" as const,
		error: appError("sidecar_down", reason),
	});

	it("shows a failed send of this chat with its reason, Retry and Discard", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const sessions = test.container.services.sessions;
			const chat = must(await sessions.create(workspace.id, CONFIG));
			const other = must(await sessions.create(workspace.id, CONFIG));
			must(await sessions.start());
			sessions.store.setState({
				failedSends: { [chat.id]: [failedSend("Fix the login bug", "The agent is not running.")] },
			});

			const { container } = await mount(test, workspace.id, chat.id, other.id);

			const region = await waitFor(() => {
				const found = container.querySelector<HTMLElement>('[data-region="failed-sends"]');
				if (found === null) throw new Error("No failed send is shown yet.");
				return found;
			});
			expect(within(region).getByText("Fix the login bug")).toBeTruthy();
			expect(within(region).getByText("Message not sent")).toBeTruthy();
			expect(within(region).getByText("The agent is not running.")).toBeTruthy();
			expect(within(region).getByRole("button", { name: "Retry" })).toBeTruthy();
			expect(within(region).getByRole("button", { name: "Discard" })).toBeTruthy();
			// A message that was never sent has no turn to revert to.
			expect(within(region).queryByRole("button", { name: /Revert/ })).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Open the other chat" }));

			await waitFor(() =>
				expect(container.querySelector('[data-region="failed-sends"]')).toBeNull(),
			);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("sends the message again when the user presses Retry", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const sessions = test.container.services.sessions;
			const chat = must(await sessions.create(workspace.id, CONFIG));
			const other = must(await sessions.create(workspace.id, CONFIG));
			must(await sessions.start());
			sessions.store.setState({
				failedSends: { [chat.id]: [failedSend("Fix the login bug", "The agent is not running.")] },
			});
			const retry = vi.spyOn(sessions, "retryFailedSend");
			await mount(test, workspace.id, chat.id, other.id);

			fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

			await waitFor(() => expect(retry).toHaveBeenCalledWith(chat.id, "m-failed"));
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("drops the card and puts the text back in the composer when the user presses Discard", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const sessions = test.container.services.sessions;
			const chat = must(await sessions.create(workspace.id, CONFIG));
			const other = must(await sessions.create(workspace.id, CONFIG));
			must(await sessions.start());
			sessions.store.setState({
				failedSends: { [chat.id]: [failedSend("Fix the login bug", "The agent is not running.")] },
			});
			const { container } = await mount(test, workspace.id, chat.id, other.id);

			fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

			await waitFor(() =>
				expect(container.querySelector('[data-region="failed-sends"]')).toBeNull(),
			);
			expect(sessions.draftOf(chat.id).text).toBe("Fix the login bug");
			expect(sessions.store.getState().failedSends?.[chat.id]).toEqual([]);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});
