/**
 * @feature CHAT-06 Chat tab
 * Owns: tests of the chat pane over the real container and its real children (message list, dock, composer and
 * the rest). The pane's own work is the effect that records the chat on screen and marks the workspace read.
 * Behaviour: ui-map.md 3.3 (chat view), 4 (opening a workspace clears its unread chats, except chats that still
 * wait for the user).
 * Test first: the pane lays out the message list, dock, progress, queue and composer for a seeded chat.
 */
import type { SessionConfig } from "@conducted/protocol";
import {
	appError,
	err,
	type InteractionId,
	type SessionId,
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
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
	await router.load();
	return view;
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

	it("tells the user when the workspace could not be marked read", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const other = must(await test.container.services.sessions.create(workspace.id, CONFIG));
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
