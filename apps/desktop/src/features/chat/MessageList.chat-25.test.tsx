/**
 * @feature CHAT-25 Turn outline and jump list
 * Owns: the outline reached from the real message list over the real container: its trigger sits with
 * the list, its ticks follow the chat's turns, picking a turn scrolls the list to that turn's index,
 * and the highlight follows the list's visible range.
 * Behaviour: coverage/inventory-controls.md (a "Table of contents" button beside the message list).
 * Test first: two stored turns put the outline beside the list with two ticks.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, MessageId, TurnId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { type VirtuosoHandle, VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
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

let test: ReturnType<typeof createTestContainer> | undefined;

afterEach(async () => {
	cleanup();
	if (test !== undefined) {
		await test.container.stop();
		test.close();
		test = undefined;
	}
});

const userMessage = (index: number, text: string): SessionEvent => ({
	at: (index + 1) * 1_000,
	turnId: `t${index + 1}` as TurnId,
	eventId: `e${index + 1}` as EventId,
	type: "user_message",
	messageId: `m${index + 1}` as MessageId,
	text,
	attachmentPaths: [],
	delivery: "new_turn",
	config: CONFIG,
});

/** A chat in the real container with one stored turn per text. */
async function storedChat(texts: readonly string[]) {
	const created = createTestContainer();
	test = created;
	const workspace = await seedWorkspace(created.container);
	const sessions = created.container.services.sessions;
	const chat = must(await sessions.create(workspace.id, CONFIG));
	must(await sessions.start());
	for (const [idx, text] of texts.entries()) {
		const event = userMessage(idx, text);
		sessions.applyStoredEvent(chat.id, idx, event, event.at);
	}
	// The chat pane opens a chat it shows; this test shows the list alone.
	must(await sessions.open(chat.id));
	return { container: created.container, chat, workspace };
}

describe("CHAT-25 turn outline beside the message list", () => {
	it("shows the table of contents with one tick per stored turn", async () => {
		const { container, chat, workspace } = await storedChat([
			"First stored turn",
			"Second stored turn",
		]);

		render(
			<ServicesProvider container={container}>
				<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
					<MessageList sessionId={chat.id} workspaceId={workspace.id} />
				</VirtuosoMockContext.Provider>
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Table of contents" })).toBeTruthy();
		expect(screen.getAllByTestId("turn-outline-tick")).toHaveLength(2);
	});

	it("scrolls the list to the picked turn's index and highlights the turn at the top of the list", async () => {
		const { container, chat, workspace } = await storedChat([
			"First stored turn",
			"Second stored turn",
			"Third stored turn",
		]);
		const listRef = createRef<VirtuosoHandle>();

		render(
			<ServicesProvider container={container}>
				<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
					<MessageList sessionId={chat.id} workspaceId={workspace.id} listRef={listRef} />
				</VirtuosoMockContext.Provider>
			</ServicesProvider>,
		);

		const trigger = await screen.findByRole("button", { name: "Table of contents" });
		// The list reports its visible range once it scrolls; the highlight follows that range.
		const scroller = document.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]');
		if (scroller === null) throw new Error("The message list has no scroller.");
		act(() => {
			fireEvent.scroll(scroller, { target: { scrollTop: 0 } });
		});

		fireEvent.click(trigger);
		const first = await screen.findByRole("button", { name: "First stored turn" });
		await waitFor(() => expect(first.getAttribute("aria-current")).toBe("location"));
		expect(
			screen.getByRole("button", { name: "Second stored turn" }).getAttribute("aria-current"),
		).toBeNull();

		const handle = listRef.current;
		if (handle === null) throw new Error("The message list gave no handle.");
		const scrollToIndex = vi.spyOn(handle, "scrollToIndex");
		fireEvent.click(screen.getByRole("button", { name: "Second stored turn" }));
		expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, align: "start" });
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Second stored turn" })).toBeNull(),
		);
	});
});
