/**
 * @feature CHAT-17 Chat search bar
 * Owns: tests for the find bar over the real chat pane and container: the match count, next and
 * previous from the root dispatcher, scroll to the current match (also in a turn the list has not
 * mounted), no scrolling while an answer streams in, the query kept across a chat switch, Escape,
 * and the copy-transcript shortcut.
 * Behaviour: ui-map.md 3.3, 5.4.
 * Test first: Typing 'foo' with three matches shows '1 of 3' and Cmd+G moves to '2 of 3'.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, MessageId, SessionId, TurnId, WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect, useState } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, useCommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { ChatPane } from "./ChatPane.tsx";
import { ChatSearchBar } from "./ChatSearchBar.tsx";

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

function Dispatcher({ children }: { children: ReactNode }) {
	useCommandDispatcher();
	return <>{children}</>;
}

let test: TestContainer | undefined;

afterEach(async () => {
	cleanup();
	clearCommandHandlers();
	vi.restoreAllMocks();
	if (test !== undefined) {
		await test.container.stop();
		test.close();
		test = undefined;
	}
});

async function mountChatWithMatches() {
	test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const sessions = test.container.services.sessions;
	const chat = must(await sessions.create(workspace.id, CONFIG));
	must(await sessions.start());

	const base = { at: 1_000, turnId: "t1" as TurnId };
	const events: SessionEvent[] = [
		{
			...base,
			eventId: "e1" as EventId,
			type: "user_message",
			messageId: "m1" as MessageId,
			text: "The foo case",
			attachmentPaths: [],
			delivery: "new_turn",
			config: CONFIG,
		},
		{
			...base,
			eventId: "e2" as EventId,
			type: "agent",
			message: {
				agent: "claude",
				items: [
					{ kind: "text", text: "Another foo" },
					{ kind: "thinking", text: "A thoughtful note", summarized: false },
				],
			},
		},
		{
			...base,
			eventId: "e3" as EventId,
			turnId: "t2" as TurnId,
			type: "user_message",
			messageId: "m2" as MessageId,
			text: "A third foo",
			attachmentPaths: [],
			delivery: "new_turn",
			config: CONFIG,
		},
	];
	for (const [idx, event] of events.entries()) {
		sessions.applyStoredEvent(chat.id, idx, event, event.at);
	}

	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <ChatPane workspaceId={workspace.id} sessionId={chat.id} />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
				<Dispatcher>
					<RouterProvider router={router} />
				</Dispatcher>
			</VirtuosoMockContext.Provider>
		</ServicesProvider>,
	);
	await router.load();
	return { container: test.container, chat };
}

const userMessage = (turn: string, text: string, at: number): SessionEvent => ({
	at,
	turnId: turn as TurnId,
	eventId: `user-${turn}` as EventId,
	type: "user_message",
	messageId: `message-${turn}` as MessageId,
	text,
	attachmentPaths: [],
	delivery: "new_turn",
	config: CONFIG,
});

/** Shows one chat pane whose chat the test can switch, as a tab switch does. */
function SwitchablePane({
	workspaceId,
	first,
	onReady,
}: {
	workspaceId: WorkspaceId;
	first: SessionId;
	onReady: (switchTo: (id: SessionId) => void) => void;
}) {
	const [sessionId, setSessionId] = useState(first);
	useEffect(() => onReady(setSessionId), [onReady]);
	return <ChatPane workspaceId={workspaceId} sessionId={sessionId} />;
}

function openFindBar() {
	const messages = document.querySelector('[data-region="messages"]');
	if (messages === null) throw new Error("The chat pane has no message region.");
	fireEvent.keyDown(messages, { key: "f", metaKey: true });
	return screen.findByRole("textbox", { name: "Find in messages and thinking" });
}

describe("CHAT-17 chat search bar", () => {
	it("counts the matches and moves through them with Cmd+G and Cmd+Shift+G", async () => {
		await mountChatWithMatches();
		await waitFor(() =>
			expect(test?.container.services.sessions.store.getState().viewingSessionId).not.toBeNull(),
		);

		const input = await openFindBar();
		fireEvent.change(input, { target: { value: "foo" } });
		expect(screen.getByText("1 of 3")).toBeTruthy();

		fireEvent.keyDown(input, { key: "g", metaKey: true });
		expect(screen.getByText("2 of 3")).toBeTruthy();

		fireEvent.keyDown(input, { key: "g", metaKey: true, shiftKey: true });
		expect(screen.getByText("1 of 3")).toBeTruthy();

		fireEvent.change(input, { target: { value: "zzz" } });
		expect(screen.getByText("0 results")).toBeTruthy();
	});

	it("finds a match in the agent's thinking", async () => {
		await mountChatWithMatches();
		await waitFor(() =>
			expect(test?.container.services.sessions.store.getState().viewingSessionId).not.toBeNull(),
		);

		const input = await openFindBar();
		fireEvent.change(input, { target: { value: "thoughtful" } });
		expect(screen.getByText("1 of 1")).toBeTruthy();
	});

	it("scrolls the current match into view with Cmd+Alt+J", async () => {
		const scrollIntoView = vi
			.spyOn(Element.prototype, "scrollIntoView")
			.mockImplementation(() => {});
		await mountChatWithMatches();
		await waitFor(() =>
			expect(test?.container.services.sessions.store.getState().viewingSessionId).not.toBeNull(),
		);
		// The list mounts its turns only after its first scroll to the newest turn, a few frames
		// after it renders. The first match is in turn t1, which must be mounted to scroll into view.
		await waitFor(() => expect(document.querySelector('[data-turn="t1"]')).not.toBeNull());

		const input = await openFindBar();
		fireEvent.change(input, { target: { value: "foo" } });
		scrollIntoView.mockClear();
		fireEvent.keyDown(input, { key: "j", metaKey: true, altKey: true });

		expect(scrollIntoView).toHaveBeenCalled();
	});

	it("does not move the view while an answer streams in with the bar open", async () => {
		const scrolledTurns: string[] = [];
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
			if (this instanceof HTMLElement && this.dataset.turn !== undefined) {
				scrolledTurns.push(this.dataset.turn);
			}
		});
		const { container, chat } = await mountChatWithMatches();
		await waitFor(() =>
			expect(container.services.sessions.store.getState().viewingSessionId).not.toBeNull(),
		);
		const input = await openFindBar();
		fireEvent.change(input, { target: { value: "foo" } });
		expect(screen.getByText("1 of 3")).toBeTruthy();
		scrolledTurns.length = 0;

		act(() => {
			container.services.sessions.applyStoredEvent(
				chat.id,
				3,
				{
					at: 2_000,
					turnId: "t2" as TurnId,
					eventId: "e4" as EventId,
					type: "agent",
					message: { agent: "claude", items: [{ kind: "text", text: "A streamed foo" }] },
				},
				2_000,
			);
		});

		await waitFor(() => expect(screen.getByText("1 of 4")).toBeTruthy());
		expect(scrolledTurns).toEqual([]);
	});

	it("keeps the query when the pane switches to another chat", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const sessions = test.container.services.sessions;
		const first = must(await sessions.create(workspace.id, CONFIG));
		const second = must(await sessions.create(workspace.id, CONFIG));
		must(await sessions.start());
		sessions.applyStoredEvent(first.id, 0, userMessage("t1", "The foo case", 1_000), 1_000);
		sessions.applyStoredEvent(second.id, 0, userMessage("t9", "Another foo", 1_000), 1_000);

		let switchTo: (id: SessionId) => void = () => {
			throw new Error("The pane is not mounted yet.");
		};
		const rootRoute = createRootRoute();
		const route = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: () => (
				<SwitchablePane
					workspaceId={workspace.id}
					first={first.id}
					onReady={(next) => {
						switchTo = next;
					}}
				/>
			),
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([route]),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		render(
			<ServicesProvider container={test.container}>
				<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
					<Dispatcher>
						<RouterProvider router={router} />
					</Dispatcher>
				</VirtuosoMockContext.Provider>
			</ServicesProvider>,
		);
		await router.load();
		await waitFor(() => expect(sessions.store.getState().viewingSessionId).toBe(first.id));

		const input = await openFindBar();
		fireEvent.change(input, { target: { value: "foo" } });
		expect(screen.getByText("1 of 1")).toBeTruthy();

		act(() => switchTo(second.id));
		await waitFor(() => expect(sessions.store.getState().viewingSessionId).toBe(second.id));

		const kept = screen.getByRole("textbox", { name: "Find in messages and thinking" });
		expect((kept as HTMLInputElement).value).toBe("foo");
		expect(screen.getByText("1 of 1")).toBeTruthy();
	});

	it("asks the list to scroll to a matching turn it has not mounted", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const sessions = test.container.services.sessions;
		const chat = must(await sessions.create(workspace.id, CONFIG));
		must(await sessions.start());
		// A long chat: only turns 3 and 57 mention the needle, and the list mounts neither of them.
		for (let turn = 0; turn < 60; turn += 1) {
			const text = turn === 3 || turn === 57 ? `Turn ${turn} has the needle` : `Turn ${turn}`;
			sessions.applyStoredEvent(chat.id, turn, userMessage(`t${turn}`, text, turn), turn);
		}
		const revealed: number[] = [];
		// The chat pane records its chat as the one on screen, and the find bar's shortcuts need an
		// open chat. This test shows the bar without the pane, so it records the chat itself.
		sessions.setViewing(chat.id);

		render(
			<ServicesProvider container={test.container}>
				<Dispatcher>
					<div data-command-scope="chat-input">
						<ChatSearchBar
							sessionId={chat.id}
							open
							onClose={() => {}}
							onRevealTurn={(index) => revealed.push(index)}
						/>
					</div>
				</Dispatcher>
			</ServicesProvider>,
		);
		const input = await screen.findByRole("textbox", { name: "Find in messages and thinking" });
		fireEvent.change(input, { target: { value: "needle" } });
		expect(screen.getByText("1 of 2")).toBeTruthy();
		fireEvent.keyDown(input, { key: "Enter" });
		expect(screen.getByText("2 of 2")).toBeTruthy();
		fireEvent.keyDown(input, { key: "j", metaKey: true, altKey: true });

		expect(revealed).toEqual([3, 57, 57]);
	});

	it("closes on Escape and copies the concise transcript with Cmd+Alt+C", async () => {
		const { container } = await mountChatWithMatches();
		await waitFor(() =>
			expect(container.services.sessions.store.getState().viewingSessionId).not.toBeNull(),
		);

		const input = await openFindBar();
		fireEvent.keyDown(input, { key: "Escape" });
		expect(screen.queryByRole("textbox", { name: "Find in messages and thinking" })).toBeNull();

		const messages = document.querySelector('[data-region="messages"]');
		if (messages === null) throw new Error("The chat pane has no message region.");
		fireEvent.keyDown(messages, { key: "c", metaKey: true, altKey: true });
		await waitFor(() =>
			expect(test?.memory.controls.clipboardText ?? "").toContain("The foo case"),
		);
		expect(test?.memory.controls.clipboardText ?? "").toContain("Another foo");
		expect(test?.memory.controls.clipboardText ?? "").not.toContain("Input:");
	});
});
