/**
 * @feature CHAT-25 Turn outline and jump list
 * Owns: the outline reached from the real message list over the real container: its trigger sits with
 * the list and its ticks follow the chat's turns.
 * Behaviour: coverage/inventory-controls.md (a "Table of contents" button beside the message list).
 * Test first: two stored turns put the outline beside the list with two ticks.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, MessageId, TurnId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it } from "vitest";
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

describe("CHAT-25 turn outline beside the message list", () => {
	it("shows the table of contents with one tick per stored turn", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const sessions = test.container.services.sessions;
		const chat = must(await sessions.create(workspace.id, CONFIG));
		must(await sessions.start());

		const events: SessionEvent[] = [
			{
				at: 1_000,
				turnId: "t1" as TurnId,
				eventId: "e1" as EventId,
				type: "user_message",
				messageId: "m1" as MessageId,
				text: "First stored turn",
				attachmentPaths: [],
				delivery: "new_turn",
				config: CONFIG,
			},
			{
				at: 2_000,
				turnId: "t2" as TurnId,
				eventId: "e2" as EventId,
				type: "user_message",
				messageId: "m2" as MessageId,
				text: "Second stored turn",
				attachmentPaths: [],
				delivery: "new_turn",
				config: CONFIG,
			},
		];
		for (const [idx, event] of events.entries()) {
			sessions.applyStoredEvent(chat.id, idx, event, event.at);
		}

		render(
			<ServicesProvider container={test.container}>
				<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
					<MessageList sessionId={chat.id} workspaceId={workspace.id} />
				</VirtuosoMockContext.Provider>
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Table of contents" })).toBeTruthy();
		expect(screen.getAllByTestId("turn-outline-tick")).toHaveLength(2);
	});
});
