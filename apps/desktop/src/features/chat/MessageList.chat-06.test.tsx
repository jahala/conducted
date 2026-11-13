/**
 * @feature CHAT-06 Message list: a chat's history loads a few turns at a time
 * Owns: the list over the real container and a real SQLite, for a chat longer than its first
 * page: the header that loads older turns, its Retry, and the outline's jump to a turn that is not
 * loaded.
 * Behaviour: renderApp `_ma` @9596613 and `tWt` @9596053 ("Loading messages…", "Couldn't load
 * messages" with Retry), `Wma` @9609810 (the list stays hidden while older turns fill it).
 * Test first: a chat longer than its first page shows "Loading messages…" above its turns.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, MessageId, SessionId, TurnId, WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type VirtuosoHandle, VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { SESSION_EVENTS_SQL } from "../../core/db/session-events.ts";
import {
	createTestContainer,
	seedSessionEvent,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { failingOnSelect } from "../../test/failing-database.ts";
import { MessageList } from "./MessageList.tsx";

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

let test: TestContainer | undefined;

afterEach(async () => {
	cleanup();
	if (test !== undefined) {
		await test.container.stop();
		test.close();
		test = undefined;
	}
});

const userMessage = (index: number): SessionEvent => ({
	at: (index + 1) * 1_000,
	turnId: `t${index}` as TurnId,
	eventId: `e${index}` as EventId,
	type: "user_message",
	messageId: `m${index}` as MessageId,
	text: `Stored turn ${index}`,
	attachmentPaths: [],
	delivery: "new_turn",
	config: CONFIG,
});

/** A stored chat of `turns` turns of one message each, opened as the chat pane opens it. */
async function openedChat(
	turns: number,
	failing: () => boolean = () => false,
): Promise<{ test: TestContainer; id: SessionId; workspaceId: WorkspaceId }> {
	const created = createTestContainer({
		wrapDatabase: (database) =>
			failingOnSelect(
				database,
				SESSION_EVENTS_SQL.listTurns,
				new Error("The disk is gone."),
				failing,
			),
	});
	test = created;
	const workspace = await seedWorkspace(created.container);
	const sessions = created.container.services.sessions;
	const chat = must(await sessions.create(workspace.id, CONFIG));
	must(await sessions.start());
	for (let index = 0; index < turns; index++) {
		const event = userMessage(index);
		await seedSessionEvent(created.container, chat.id, event, event.at);
	}
	must(await sessions.open(chat.id));
	return { test: created, id: chat.id, workspaceId: workspace.id };
}

function renderList(
	opened: { test: TestContainer; id: SessionId; workspaceId: WorkspaceId },
	listRef?: React.RefObject<VirtuosoHandle | null>,
) {
	return render(
		<ServicesProvider container={opened.test.container}>
			<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
				<MessageList sessionId={opened.id} workspaceId={opened.workspaceId} listRef={listRef} />
			</VirtuosoMockContext.Provider>
		</ServicesProvider>,
	);
}

const loadedTurns = (opened: { test: TestContainer; id: SessionId }): number =>
	opened.test.container.services.sessions.chatView(opened.id)?.turns.length ?? 0;

describe("CHAT-06 the message list loads older turns at its top (#617)", () => {
	it("a chat longer than its first page shows Loading messages above its turns", async () => {
		const opened = await openedChat(9);
		renderList(opened);

		expect(await screen.findByRole("status", { name: "Loading messages" })).toBeTruthy();
		expect(screen.getByText("Loading messages…")).toBeTruthy();
	});

	it("a chat that fits its first page has nothing to load", async () => {
		const opened = await openedChat(3);
		renderList(opened);

		await screen.findByRole("button", { name: "Table of contents" });
		expect(screen.queryByRole("status", { name: "Loading messages" })).toBeNull();
	});

	it("loads older turns while the top of the list is near, until none are left", async () => {
		const opened = await openedChat(9);
		renderList(opened);
		const scroller = await waitFor(() => {
			const found = document.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]');
			if (found === null) throw new Error("The message list has no scroller yet.");
			return found;
		});

		act(() => {
			fireEvent.scroll(scroller, { target: { scrollTop: 0 } });
		});

		await waitFor(() => expect(loadedTurns(opened)).toBe(9));
		await waitFor(() =>
			expect(screen.queryByRole("status", { name: "Loading messages" })).toBeNull(),
		);
	});

	it("a failed load says Couldn't load messages, and Retry loads the turn", async () => {
		let failing = false;
		const opened = await openedChat(9, () => failing);
		failing = true;
		const failed = await opened.test.container.actions.sessions.loadOlder(opened.id);
		expect(failed.ok).toBe(false);
		renderList(opened);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("Couldn't load messages");
		failing = false;
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() => expect(loadedTurns(opened)).toBeGreaterThan(5));
	});

	it("picking a turn in the outline that is not loaded loads every turn back to it and scrolls there", async () => {
		const opened = await openedChat(9);
		// The list's handle is made again when its turns change, so every handle it gets is recorded.
		// Each scroll also records how many turns were loaded at that moment: once the list reaches
		// its top, the ordinary paging may load one older turn, which is not the jump's doing.
		const scrolledTo: unknown[] = [];
		const loadedAtScroll: number[] = [];
		let handle: VirtuosoHandle | null = null;
		const listRef: { current: VirtuosoHandle | null } = {
			get current() {
				return handle;
			},
			set current(next) {
				handle =
					next === null
						? null
						: {
								...next,
								scrollToIndex: (location) => {
									scrolledTo.push(location);
									loadedAtScroll.push(loadedTurns(opened));
									next.scrollToIndex(location);
								},
							};
			},
		};
		renderList(opened, listRef);

		fireEvent.click(await screen.findByRole("button", { name: "Table of contents" }));
		fireEvent.click(await screen.findByRole("button", { name: "Stored turn 1" }));

		await waitFor(() => expect(scrolledTo).toContainEqual({ index: 0, align: "start" }));
		// The jump loads every turn back to the picked one, and no further.
		const jump = scrolledTo.findIndex(
			(location) => JSON.stringify(location) === JSON.stringify({ index: 0, align: "start" }),
		);
		expect(loadedAtScroll[jump]).toBe(8);
	});
});
