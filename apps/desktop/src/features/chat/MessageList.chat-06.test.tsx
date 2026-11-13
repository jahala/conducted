/**
 * @feature CHAT-06 Message list: a chat's history loads a few turns at a time
 * Owns: the list over the real container and a real SQLite, for a chat longer than its first
 * page: the header that loads older turns, its Retry, the outline's jump to a turn that is not
 * loaded, and the gap that jump leaves, with its own Retry (#652).
 * Behaviour: renderApp `_ma` @9596613 and `tWt` @9596053 ("Loading messages…", "Couldn't load
 * messages" with Retry), `Wma` @9609810 (the list stays hidden while older turns fill it).
 * Test first: a chat longer than its first page shows "Loading messages…" above its turns.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, MessageId, SessionId, TurnId, WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** The list's viewport, in pixels, under jsdom, which has no layout. */
const VIEWPORT_PX = 800;

function renderList(
	opened: { test: TestContainer; id: SessionId; workspaceId: WorkspaceId },
	listRef?: React.RefObject<VirtuosoHandle | null>,
	turnHeight = 200,
) {
	return render(
		<ServicesProvider container={opened.test.container}>
			<VirtuosoMockContext.Provider value={{ viewportHeight: VIEWPORT_PX, itemHeight: turnHeight }}>
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

	it("picking a turn in the outline that is not loaded loads that turn alone and scrolls there (#652)", async () => {
		// Long enough that the ordinary paging at the list's top, which may run meanwhile, cannot reach
		// the picked turn's neighbours.
		const opened = await openedChat(30);
		// The list's handle is made again when its turns change, so every handle it gets is recorded.
		// Each scroll records the turn at its index and the turns loaded at that moment.
		const scrolls: { turnId: string | undefined; loaded: string[] }[] = [];
		let handle: VirtuosoHandle | null = null;
		const loaded = (): string[] =>
			opened.test.container.services.sessions
				.chatView(opened.id)
				?.turns.map((turn) => turn.turnId) ?? [];
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
									const index = typeof location === "number" ? location : location.index;
									const turns = loaded();
									scrolls.push({
										turnId: typeof index === "number" ? turns[index] : undefined,
										loaded: turns,
									});
									next.scrollToIndex(location);
								},
							};
			},
		};
		// The list must be far from its top, or the ordinary paging loads the older turns itself
		// (#674). Five turns of 400 px end 1,200 px below the top of an 800 px viewport, past the
		// 800 px that count as near. jsdom never moves the scroller, so the list is put at its bottom
		// by a scroll event before anything awaits: Virtuoso reads its first position a few frames
		// after mounting, and at 0 the paging would start.
		const turnHeight = 400;
		renderList(opened, listRef, turnHeight);
		fireEvent.scroll(screen.getByTestId("virtuoso-scroller"), {
			target: { scrollTop: 5 * turnHeight - VIEWPORT_PX },
		});

		fireEvent.click(await screen.findByRole("button", { name: "Table of contents" }));
		fireEvent.click(await screen.findByRole("button", { name: "Stored turn 1" }));

		await waitFor(() => expect(scrolls.map((scroll) => scroll.turnId)).toContain("t1"));
		// The jump loads the picked turn alone: none of the turns after it up to the last ones.
		const jump = scrolls.find((scroll) => scroll.turnId === "t1");
		expect(jump?.loaded).not.toContain("t2");
		expect(jump?.loaded).not.toContain("t20");
		// A gap marker stands between it and the turns the chat opened on.
		await waitFor(() =>
			expect(document.querySelectorAll("[data-transcript-gap-marker]")).toHaveLength(1),
		);
	});

	it("a gap whose fill failed says Couldn't load messages on its marker, and Retry loads a turn of it", async () => {
		let failing = false;
		const opened = await openedChat(9, () => failing);
		const actions = opened.test.container.actions.sessions;
		// Turns 0 and 1 load on their own, so nothing is older and the list shows at once.
		must(await actions.revealTurn(opened.id, "t1" as TurnId));
		must(await actions.revealTurn(opened.id, "t0" as TurnId));
		failing = true;
		const failed = await actions.fillGap(opened.id, "t4" as TurnId, "after-earlier");
		expect(failed.ok).toBe(false);
		renderList(opened);

		const marker = await waitFor(() => {
			const found = document.querySelector<HTMLElement>("[data-transcript-gap-marker]");
			if (found === null) throw new Error("No gap marker yet.");
			return found;
		});
		expect(marker.textContent).toContain("Couldn't load messages");
		failing = false;
		// Virtuoso keeps its item list at visibility hidden until it reaches its first scroll place,
		// which it has not here, so the button is found by its words.
		fireEvent.click(within(marker).getByText("Retry"));

		await waitFor(() => expect(loadedTurns(opened)).toBe(8));
	});
});
