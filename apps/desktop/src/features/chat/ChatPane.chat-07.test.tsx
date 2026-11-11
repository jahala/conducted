/**
 * @feature CHAT-07 A background helper's late work, live in the chat (D129)
 * Behaviour: a helper started by a Task call in one turn keeps writing after that turn ends. Its
 * later messages name the call as their parent and arrive in a later turn. The chat shows them
 * inside the card of the call that started them, as they arrive, and the later turn shows only its
 * own work. Conductor builds each turn from its own rows and shows such work nowhere (main `wp`
 * @1423850, `_mt` @1427823); D129 departs from that on the owner's ruling.
 * Test first: a late event appended after turn A has ended shows inside turn A's card on screen.
 */
import type { AgentItem, SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, MessageId, SessionId, ToolUseId, TurnId } from "@conducted/shared";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { ChatView } from "../../core/model.ts";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
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

afterEach(cleanup);

const T0 = 1_700_000_000_000;

const userMessage = (turn: string, text: string, at: number): SessionEvent => ({
	type: "user_message",
	eventId: `e-user-${turn}` as EventId,
	at,
	turnId: turn as TurnId,
	messageId: `m-${turn}` as MessageId,
	text,
	attachmentPaths: [],
	delivery: "new_turn",
	config: CONFIG,
});

const agentMessage = (
	turn: string,
	id: string,
	at: number,
	items: AgentItem[],
	parent?: string,
): SessionEvent => ({
	type: "agent",
	eventId: id as EventId,
	at,
	turnId: turn as TurnId,
	message: {
		agent: "claude",
		...(parent === undefined ? {} : { parentToolUseId: parent as ToolUseId }),
		items,
	},
});

const TASK = "task-1" as ToolUseId;

/** Turn A starts a background helper and ends; turn B is the user's next message. */
const EARLIER: SessionEvent[] = [
	userMessage("turn-a", "Start a helper", T0),
	agentMessage("turn-a", "e-a-1", T0 + 1, [
		{
			kind: "tool_call",
			toolUseId: TASK,
			tool: "sub_agent",
			rawName: "Task",
			input: { description: "Check the other tests", run_in_background: true },
		},
	]),
	agentMessage("turn-a", "e-a-2", T0 + 2, [
		{
			kind: "tool_result",
			toolUseId: TASK,
			output: "Async agent launched",
			isError: false,
			truncated: false,
		},
	]),
	agentMessage("turn-a", "e-a-3", T0 + 3, [{ kind: "text", text: "The helper is running." }]),
	{
		type: "turn_ended",
		eventId: "e-a-end" as EventId,
		at: T0 + 4,
		turnId: "turn-a" as TurnId,
		outcome: "success",
	},
	userMessage("turn-b", "Anything else?", T0 + 10),
	agentMessage("turn-b", "e-b-1", T0 + 11, [{ kind: "text", text: "Nothing else for now." }]),
];

/** The helper's late work: it arrives in turn B, naming turn A's Task call as its parent. */
const LATE: SessionEvent[] = [
	agentMessage("turn-b", "e-late-1", T0 + 12, [{ kind: "text", text: "Late helper note" }], TASK),
	agentMessage(
		"turn-b",
		"e-late-2",
		T0 + 13,
		[
			{
				kind: "tool_call",
				toolUseId: "late-grep" as ToolUseId,
				tool: "grep",
				rawName: "Grep",
				input: { pattern: "late-pattern" },
				parentToolUseId: TASK,
			},
		],
		TASK,
	),
];

/** The turns the chat list is handed. */
function turnsOf(view: ChatView | null): ChatView["turns"] {
	if (view === null) throw new Error("The chat has no view.");
	return view.turns;
}

function turnElement(turnId: string): HTMLElement {
	const element = document.querySelector<HTMLElement>(`[data-turn="${turnId}"]`);
	if (element === null) throw new Error(`Turn ${turnId} is not on screen.`);
	return element;
}

describe("CHAT-07 a background helper's late work in the live chat (D129)", () => {
	it("shows a late event appended after turn A has ended inside turn A's card, and redraws only that turn", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const sessions = test.container.services.sessions;
			const chat = must(await sessions.create(workspace.id, CONFIG));
			must(await sessions.start());
			const apply = (events: readonly SessionEvent[], from: number) => {
				for (const [offset, event] of events.entries()) {
					sessions.applyStoredEvent(chat.id as SessionId, from + offset, event, event.at);
				}
			};
			apply(EARLIER, 0);
			renderWithRouter(
				<ServicesProvider container={test.container}>
					<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
						<ChatPane workspaceId={workspace.id} sessionId={chat.id} />
					</VirtuosoMockContext.Provider>
				</ServicesProvider>,
			);
			await screen.findByText("Anything else?");
			const turnA = within(turnElement("turn-a"));
			const row = turnA.getByText("Subagent").closest("button");
			if (row === null) throw new Error("The Subagent card has no row to open.");
			fireEvent.click(row);
			await turnA.findByText("0 tool calls");
			const before = turnsOf(sessions.chatView(chat.id));

			apply(LATE, EARLIER.length);

			expect(await turnA.findByText("Late helper note")).toBeTruthy();
			expect(turnA.getByText("1 tool call")).toBeTruthy();
			expect(turnA.getByText(/late-pattern/)).toBeTruthy();
			const turnB = within(turnElement("turn-b"));
			expect(turnB.getByText("Nothing else for now.")).toBeTruthy();
			expect(turnB.queryByText("Late helper note")).toBeNull();
			expect(turnB.queryByText(/late-pattern/)).toBeNull();
			// The list redraws a turn only when the service hands it a new turn object.
			const after = turnsOf(sessions.chatView(chat.id));
			expect(after[0]).not.toBe(before[0]);
			expect(after[1]).toBe(before[1]);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});
