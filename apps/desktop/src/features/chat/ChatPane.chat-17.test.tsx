/**
 * @feature CHAT-17 Chat search bar
 * Owns: tests for the find bar over the real chat pane and container: the match count, next and
 * previous from the root dispatcher, scroll to the current match, Escape, and the copy-transcript
 * shortcut.
 * Behaviour: ui-map.md 3.3, 5.4.
 * Test first: Typing 'foo' with three matches shows '1 of 3' and Cmd+G moves to '2 of 3'.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, MessageId, TurnId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, useCommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
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

		const input = await openFindBar();
		fireEvent.change(input, { target: { value: "foo" } });
		scrollIntoView.mockClear();
		fireEvent.keyDown(input, { key: "j", metaKey: true, altKey: true });

		expect(scrollIntoView).toHaveBeenCalled();
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
