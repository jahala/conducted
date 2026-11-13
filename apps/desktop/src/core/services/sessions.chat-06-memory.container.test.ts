// @vitest-environment node
/**
 * @feature CHAT-06 Message list: a chat's history loads a few turns at a time
 * Opens a made-up chat at the size of the owner's longest (#617) through the real composition
 * root and a real SQLite, and bounds the memory the open keeps, and what a jump from the outline to
 * its first turn adds (#652).
 * Test first: opening a chat of 223,000 events keeps less than the bound.
 */
import { getHeapStatistics, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { AgentItem, SessionEvent } from "@conducted/protocol";
import type { Result, ToolUseId, TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import {
	agentEvent,
	sampleSession,
	turnEndedEvent,
	userMessageEvent,
} from "../db/test-fixtures.ts";

/**
 * The made-up chat: 22,300 turns of ten events (a message, three tool calls with 4,500 characters
 * of output each, a reply, the usage and the turn's end), 223,000 events and about 310 million
 * characters in all. The issue's chat had 200,900 rows; the owner's longest about 344,000 events.
 */
const TURNS = 22_300;
const OUTPUT_CHARS = 4_500;
/**
 * How much the open may keep, in MB. Measured on this chat (#617): loading every event kept 403 MB
 * of heap; the last five turns and the list of every turn keep 5.6 MB, most of it the list.
 */
const KEPT_BOUND_MB = 32;
/**
 * How much a jump to the first turn may add, in MB. Measured (#652): when the jump loaded every
 * turn from the picked one to the end it kept 402 MB more; the turn alone keeps well under 1 MB.
 */
const JUMP_BOUND_MB = 8;
const MB = 1024 * 1024;

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

function turnEvents(turn: number): SessionEvent[] {
	const id = `t${turn}`;
	const at = turn * 10;
	const output = `${turn}:`.padEnd(OUTPUT_CHARS, "x");
	const calls: AgentItem[][] = [];
	for (let call = 0; call < 3; call++) {
		const toolUseId = `tu-${turn}-${call}` as ToolUseId;
		calls.push(
			[
				{
					kind: "tool_call",
					toolUseId,
					tool: "read",
					rawName: "Read",
					input: { file_path: "a.ts" },
				},
			],
			[{ kind: "tool_result", toolUseId, output, isError: false, truncated: false }],
		);
	}
	return [
		userMessageEvent(`u-${turn}`, id, at),
		...calls.map((items, index) => agentEvent(`a-${turn}-${index}`, id, at + 1, items)),
		agentEvent(`r-${turn}`, id, at + 2, [{ kind: "text", text: `Reply ${turn}` }]),
		agentEvent(`s-${turn}`, id, at + 3, [
			{
				kind: "usage",
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				costUsd: 0.01,
			},
		]),
		turnEndedEvent(`e-${turn}`, id, at + 4),
	];
}

/** The forced collection Node runs when asked, so the heap holds only what is still kept. */
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;
const keptHeap = (): number => {
	collect();
	collect();
	return getHeapStatistics().used_heap_size;
};

/** A container holding the made-up chat, written a thousand turns per statement as the import's staging writes (D136). */
async function longChat() {
	const test = createTestContainer();
	await test.container.services.settings.start();
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const chat = must(
		await test.container.services.sessions.create(workspace.id, sampleSession.config),
	);
	const BATCH = 1_000;
	for (let first = 0; first < TURNS; first += BATCH) {
		const events: SessionEvent[] = [];
		for (let turn = first; turn < Math.min(first + BATCH, TURNS); turn++) {
			events.push(...turnEvents(turn));
		}
		await test.database.execute(
			`INSERT INTO session_events (session_id, idx, event_id, type, turn_id, content, received_at)
			SELECT $1, $2 + item.key, json_extract(item.value, '$.eventId'),
				json_extract(item.value, '$.type'), json_extract(item.value, '$.turnId'),
				item.value, 0
			FROM json_each($3) AS item`,
			[chat.id, first * 10, JSON.stringify(events)],
		);
	}
	return { test, id: chat.id };
}

describe("CHAT-06 a long chat opens at the size of what the screen shows (#617)", () => {
	it("opening a chat of 223,000 events keeps less than the bound", async () => {
		const { test, id } = await longChat();
		try {
			const sessions = test.container.services.sessions;
			const before = keptHeap();

			must(await sessions.open(id));
			const view = sessions.chatView(id);
			const kept = (keptHeap() - before) / MB;

			// The chat opens at its end, and the last turn is whole.
			const last = view?.turns.at(-1);
			expect(last?.turnId).toBe(`t${TURNS - 1}`);
			expect(last?.blocks.filter((block) => block.kind === "tool")).toHaveLength(3);
			expect(kept).toBeLessThan(KEPT_BOUND_MB);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("jumping from the outline to the first turn of that chat adds less than the bound (#652)", async () => {
		const { test, id } = await longChat();
		try {
			const sessions = test.container.services.sessions;
			must(await sessions.open(id));
			sessions.chatView(id);
			const before = keptHeap();

			must(await test.container.actions.sessions.revealTurn(id, "t0" as TurnId));
			const view = sessions.chatView(id);
			const kept = (keptHeap() - before) / MB;

			// The first turn joins the five the chat opened on, with a gap between them.
			expect(view?.turns.map((turn) => turn.turnId)).toEqual([
				"t0",
				...Array.from({ length: 5 }, (_, index) => `t${TURNS - 5 + index}`),
			]);
			expect(view?.history.gaps).toEqual([{ beforeTurnId: `t${TURNS - 5}`, state: "idle" }]);
			expect(kept).toBeLessThan(JUMP_BOUND_MB);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
