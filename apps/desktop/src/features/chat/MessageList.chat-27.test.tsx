/**
 * @feature CHAT-27 Visible auto-retry with Retry now
 * Behaviour: ui-map.md 3.3 (the running turn shows 'Something went wrong, retrying n/m').
 * Test first: the message list gives the live retry to the last turn only.
 */
import { idleLiveState } from "@conducted/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers } from "../../app/command-dispatcher.ts";
import type { ChatTurn, ChatView } from "../../core/model.ts";

const state = vi.hoisted(() => ({ chat: null as unknown }));

vi.mock("../../core/hooks.ts", () => ({
	useChat: () => state.chat,
	useWorkspace: () => ({ state: "ready", data: { state: "ready" } }),
	useDraft: () => ({ text: "", attachmentPaths: [] }),
	useSetting: () => false,
	useActions: () => ({
		settings: { set: vi.fn(async () => ({ ok: true, value: undefined })) },
		sessions: { saveDraft: vi.fn(), send: vi.fn(), cancel: vi.fn() },
	}),
}));
vi.mock("./TurnItem.tsx", () => ({
	TurnItem: ({
		turn,
		retry,
	}: {
		turn: ChatTurn;
		retry?: { attempt: number; maxAttempts: number };
	}) => (
		<div>
			turn:{turn.turnId}
			{retry === undefined ? "" : ` retry:${retry.attempt}/${retry.maxAttempts}`}
		</div>
	),
}));

const { MessageList } = await import("./MessageList.tsx");

const sessionId = "s1" as Parameters<typeof MessageList>[0]["sessionId"];
const workspaceId = "w1" as Parameters<typeof MessageList>[0]["workspaceId"];

const turn = (id: string) =>
	({ turnId: id, userMessage: null, steers: [], blocks: [] }) as unknown as ChatTurn;

function view(): ChatView {
	const turns = [turn("t1"), turn("t2")];
	return {
		session: { id: sessionId, config: { agent: "claude" } } as never,
		turns,
		liveState: {
			...idleLiveState,
			status: "working",
			retry: { attempt: 2, maxAttempts: 3 },
		},
		queued: [],
		openInteraction: null,
		progress: null,
		goal: null,
		history: { olderTurnId: null, older: "idle", gaps: [] },
		outline: turns.map((entry) => ({
			turnId: entry.turnId,
			text: null,
			plan: false,
			running: false,
		})),
	};
}

beforeEach(() => {
	clearCommandHandlers();
	state.chat = { state: "ready", data: view() };
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
});

describe("CHAT-27 message list retry line", () => {
	it("gives the live retry to the last turn only", async () => {
		render(
			<VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 100 }}>
				<MessageList sessionId={sessionId} workspaceId={workspaceId} />
			</VirtuosoMockContext.Provider>,
		);

		expect(await screen.findByText("turn:t2 retry:2/3")).toBeTruthy();
		expect(screen.getByText("turn:t1")).toBeTruthy();
	});
});
