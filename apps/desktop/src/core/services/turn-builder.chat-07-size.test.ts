// @vitest-environment node
/**
 * @feature CHAT-07 Turn builder: stored events to chat turns
 * A long chat scrolled all the way back (#653): with every one of 22,300 turns loaded, one streamed
 * event costs work and garbage for the turn it changes, not for the chat.
 * Test first: a streamed event in a chat of 22,300 loaded turns allocates less than the bound and
 * keeps every other turn.
 */
import { getHeapStatistics } from "node:v8";
import { type AgentItem, idleLiveState, type SessionEvent } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { agentEvent, turnEndedEvent, userMessageEvent } from "../db/test-fixtures.ts";
import { type StoredEvent, TurnBuilder } from "./turn-builder.ts";

/**
 * The made-up chat of #617 and #653: 22,300 turns of ten events (a message, three tool calls with
 * 4,500 characters of output each, a reply, the usage and the turn's end), 223,000 events.
 */
const TURNS = 22_300;
const OUTPUT_CHARS = 4_500;
/**
 * The most one streamed event may allocate, in MB. Measured (#653): before, a rebuild of every turn
 * and its comparison allocated about 765 MB; now about 5 MB, most of it the test's own copy of the
 * 223,000 rows (as the store copies them) and the new list of 22,300 turns.
 */
const STREAMED_BOUND_MB = 16;
const MB = 1024 * 1024;

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

const allocatedMb = (): number => getHeapStatistics().total_allocated_bytes / MB;

describe("CHAT-07 a streamed event in a long chat scrolled back (#653)", () => {
	it("a streamed event in a chat of 22,300 loaded turns allocates less than the bound and keeps every other turn", () => {
		const rows: StoredEvent[] = [];
		for (let turn = 0; turn < TURNS; turn++) {
			for (const event of turnEvents(turn)) {
				rows.push({ idx: rows.length, event, receivedAt: event.at, revertedAt: null });
			}
		}
		const working = { ...idleLiveState, status: "working" as const };
		const builder = new TurnBuilder();
		const turns = builder.update(rows, working);
		expect(turns).toHaveLength(TURNS);

		// A reply streaming into the last turn, one event at a time, as the store appends them.
		let shown = turns;
		let current = rows;
		for (let step = 0; step < 3; step++) {
			const event = agentEvent(`more-${step}`, `t${TURNS - 1}`, TURNS * 10, [
				{ kind: "text", text: `more ${step}` },
			]);
			const before = allocatedMb();
			current = [
				...current,
				{ idx: current.length, event, receivedAt: event.at, revertedAt: null },
			];
			const next = builder.update(current, working);
			const allocated = allocatedMb() - before;

			expect(allocated).toBeLessThan(STREAMED_BOUND_MB);
			const earlier = next.slice(0, -1);
			expect(earlier).toHaveLength(TURNS - 1);
			expect(earlier.every((turn, index) => turn === shown[index])).toBe(true);
			expect(next.at(-1)?.blocks.at(-1)).toEqual({ kind: "text", text: `more ${step}` });
			shown = next;
		}
	});
});
