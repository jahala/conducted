/**
 * @feature CHAT-07 Turn builder: stored events to chat turns
 * Owns: the check that a builder's updates show what a fresh build of the same events shows, over
 * made-up chats with background helpers' late work across turns, results in later turns, repeated
 * call ids, steers, reverts, older turns merged in, a changing live state and changing calls not
 * loaded (#653).
 * Test first: after every update, the builder's turns equal a fresh build of the same input.
 */
import type { AgentItem, LiveState, SessionConfig, SessionEvent } from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import type { EventId, MessageId, ToolUseId, TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { buildTurns, type StoredEvent, TurnBuilder } from "./turn-builder.ts";

/** A small seeded random source, so a failure names the seed that makes it again. */

function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

const config: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

/**
 * A made-up chat: turns of messages, calls, results, usage, steers and text. A call may name an
 * earlier call as its parent, a message may belong to any earlier call (a helper's late work), a
 * result may answer an earlier call or one that never came, and a call id is sometimes used again.
 */
function makeEvents(r: () => number, turns: number): SessionEvent[] {
	const events: SessionEvent[] = [];
	const calls: string[] = [];
	let at = 1;
	let n = 0;
	for (let t = 0; t < turns; t++) {
		const turn = `turn-${t}` as TurnId;
		const steps = 1 + Math.floor(r() * 8);
		if (r() < 0.9)
			events.push({
				type: "user_message",
				eventId: `u${n++}` as EventId,
				at: at++,
				messageId: `m${t}` as MessageId,
				turnId: turn,
				text: `msg ${t}`,
				attachmentPaths: [],
				delivery: "new_turn",
				config,
			});
		for (let s = 0; s < steps; s++) {
			const k = r();
			const items: AgentItem[] = [];
			let parent: string | undefined;
			if (r() < 0.25 && calls.length > 0) parent = calls[Math.floor(r() * calls.length)];
			if (k < 0.35) {
				const id =
					r() < 0.05 && calls.length > 0
						? (calls[Math.floor(r() * calls.length)] as string)
						: `c${n}`;
				calls.push(id);
				const p = r() < 0.3 && calls.length > 1 ? calls[Math.floor(r() * calls.length)] : undefined;
				items.push({
					kind: "tool_call",
					toolUseId: id as ToolUseId,
					tool: "bash",
					rawName: "Bash",
					input: {},
					...(p ? { parentToolUseId: p as ToolUseId } : {}),
				});
			} else if (k < 0.6 && calls.length > 0) {
				const id = r() < 0.1 ? `ghost${n}` : (calls[Math.floor(r() * calls.length)] as string);
				items.push({
					kind: "tool_result",
					toolUseId: id as ToolUseId,
					output: `out${n}`,
					isError: false,
					truncated: false,
				});
			} else if (k < 0.7) {
				items.push({
					kind: "usage",
					inputTokens: 1,
					outputTokens: 2,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				});
			} else if (k < 0.75) {
				events.push({
					type: "user_message",
					eventId: `s${n++}` as EventId,
					at: at++,
					messageId: `st${n}` as MessageId,
					turnId: turn,
					text: "steer",
					attachmentPaths: [],
					delivery: "steer",
					config,
				});
				continue;
			} else {
				items.push({ kind: "text", text: `text ${n}` });
			}
			events.push({
				type: "agent",
				eventId: `a${n++}` as EventId,
				at: at++,
				turnId: turn,
				message: {
					agent: "claude",
					items,
					...(parent ? { parentToolUseId: parent as ToolUseId } : {}),
				},
			});
		}
		if (r() < 0.8)
			events.push({
				type: "turn_ended",
				eventId: `e${n++}` as EventId,
				at: at++,
				turnId: turn,
				outcome: "success",
			});
	}
	return events;
}

const rows = (events: SessionEvent[]): StoredEvent[] =>
	events.map((event, idx) => ({ idx, event, receivedAt: event.at, revertedAt: null }));

describe("CHAT-07 an update shows what a fresh build shows (#653)", () => {
	it("after every update, the builder's turns equal a fresh build of the same input", () => {
		let compared = 0;
		for (let seed = 1; seed <= 400; seed++) {
			const r = rng(seed);
			const all = rows(makeEvents(r, 2 + Math.floor(r() * 30)));
			const builder = new TurnBuilder();
			// Start from the last few turns' rows, as an open does.
			const turnIds = [...new Set(all.map((row) => row.event.turnId))];
			const startTurn = turnIds[Math.floor(r() * turnIds.length)];
			let current = all.filter(
				(row) => turnIds.indexOf(row.event.turnId) >= turnIds.indexOf(startTurn as TurnId),
			);
			const cut = Math.floor(r() * current.length);
			let pendingAppend = current.slice(cut);
			current = current.slice(0, cut);
			let state: LiveState = { ...idleLiveState, status: "working" };
			let notLoaded = new Set<string>();
			for (let step = 0; step < 60; step++) {
				// Rows appended as they stream, older turns merged in, a revert, a new live state, or a
				// new set of calls not loaded.
				const op = r();
				if (op < 0.5 && pendingAppend.length > 0) {
					const k = 1 + Math.floor(r() * 3);
					current = [...current, ...pendingAppend.slice(0, k)];
					pendingAppend = pendingAppend.slice(k);
				} else if (op < 0.6) {
					// Merge in everything older.
					const have = new Set(current.map((row) => row.idx));
					const older = all.filter((row) => !have.has(row.idx) && !pendingAppend.includes(row));
					const merged = [...current, ...older].sort((a, b) => a.idx - b.idx);
					current = merged;
				} else if (op < 0.68 && current.length > 0) {
					const from = Math.floor(r() * current.length);
					current = current.map((row, index) =>
						index >= from && row.revertedAt === null ? { ...row, revertedAt: 5 } : row,
					);
				} else if (op < 0.78) {
					const steers = current.flatMap((row) =>
						row.event.type === "user_message" && row.event.delivery === "steer"
							? [row.event.messageId]
							: [],
					);
					state = {
						...state,
						status: r() < 0.5 ? "working" : "idle",
						pendingSteerIds: steers.filter(() => r() < 0.5),
					};
				} else if (op < 0.86) {
					const ids = current.flatMap((row) =>
						row.event.type === "agent"
							? row.event.message.items.flatMap((item) =>
									item.kind === "tool_call" || item.kind === "tool_result"
										? [item.toolUseId as string]
										: [],
								)
							: [],
					);
					notLoaded = new Set(ids.filter(() => r() < 0.3).map((id) => `${id}`));
					if (r() < 0.5) notLoaded.add("ghost1");
				}
				const sends =
					r() < 0.2
						? [
								{
									messageId: "m3" as MessageId,
									text: "x",
									at: 9,
									delivery: (r() < 0.5 ? "steer" : "new_turn") as "steer" | "new_turn",
								},
							]
						: [];
				const got = builder.update(current, state, sends, notLoaded);
				const want = buildTurns(current, state, sends, notLoaded);
				if (JSON.stringify(got) !== JSON.stringify(want)) {
					expect.fail(`seed ${seed}, step ${step}: the update differs from a fresh build`);
				}
				compared += 1;
			}
		}
		expect(compared).toBe(400 * 60);
	});
});
