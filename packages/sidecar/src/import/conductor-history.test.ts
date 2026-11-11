import { describe, expect, test } from "bun:test";
import type { ConductorPlacedRow, SessionConfig, SessionEvent } from "@conducted/protocol";
import {
	ConductorHistoryMapper,
	type ConductorMessageRow,
	MAPPED_AGENTS,
	mapConductorMessages,
	type ReadBudget,
} from "./conductor-history.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "opus",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const map = (rows: ConductorMessageRow[], agent: "claude" | "codex" = "claude") =>
	mapConductorMessages(rows, { agent, config: { ...CONFIG, agent } });

let rowNumber = 0;
function row(
	role: string | null,
	content: unknown,
	turn_id: string | null,
	sent: number | null,
	created: number | null = sent,
): ConductorMessageRow {
	rowNumber++;
	const time = (second: number) => `2026-01-02T03:00:${String(second).padStart(2, "0")}.000Z`;
	return {
		id: `sm-${rowNumber}`,
		role,
		content: typeof content === "string" ? content : JSON.stringify(content),
		sent_at: sent === null ? null : time(sent),
		created_at: time(created ?? 0),
		turn_id,
	};
}

const say = (text: string, parent: string | null = null) => ({
	type: "assistant",
	uuid: `u-${text}`,
	parent_tool_use_id: parent,
	message: { role: "assistant", content: [{ type: "text", text }] },
});
const call = (id: string, name: string, parent: string | null = null) => ({
	type: "assistant",
	uuid: `u-${id}`,
	parent_tool_use_id: parent,
	message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] },
});
const result = (id: string, parent: string | null = null) => ({
	type: "user",
	parent_tool_use_id: parent,
	message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
});
const typed = (text: string, parent: string | null = null) => ({
	type: "user",
	parent_tool_use_id: parent,
	message: { role: "user", content: [{ type: "text", text }] },
});

/** Each event as one short line: what a reader of the test needs to see. */
function lines(events: readonly SessionEvent[]): string[] {
	return events.map((event) => {
		if (event.type === "user_message") return `${event.turnId} ${event.delivery}: ${event.text}`;
		if (event.type === "turn_ended") return `${event.turnId} ended: ${event.outcome}`;
		if (event.type !== "agent") return `${event.turnId} ${event.type}`;
		const items = event.message.items.map((item) =>
			item.kind === "text"
				? `text ${item.text}`
				: item.kind === "tool_call"
					? `call ${item.rawName}${item.parentToolUseId ? ` in ${item.parentToolUseId}` : ""}`
					: item.kind,
		);
		const parent = event.message.parentToolUseId;
		return `${event.turnId} agent${parent ? ` in ${parent}` : ""}: ${items.join(", ")}`;
	});
}

describe("APP-18 Conductor's chat history as our session events", () => {
	test("maps each turn to its user message, steers and agent events, in the order Conductor shows them", () => {
		const first = row("user", "First", "t-1", 1);
		const mapped = map([
			row("user", "Second", "t-2", 20),
			row("assistant", say("Reply two"), "t-2", 21),
			row("assistant", say("Part two"), "t-1", 4),
			first,
			row("user", "Steer it", "t-1", 3),
			// Same sent time as "Part two": the earlier creation time goes first (`kW`).
			row("assistant", say("Part one"), "t-1", 4, 2),
			row("assistant", { type: "result", subtype: "success", is_error: false }, "t-1", 5),
		]);
		expect(lines(mapped.events)).toEqual([
			"t-1 new_turn: First",
			"t-1 steer: Steer it",
			"t-1 agent: text Part one",
			"t-1 agent: text Part two",
			"t-1 agent: usage",
			"t-1 ended: success",
			"t-2 new_turn: Second",
			"t-2 agent: text Reply two",
			"t-2 ended: interrupted",
		]);
		const opening = mapped.events[0];
		expect(opening?.type === "user_message" && (opening.messageId as string)).toBe(first.id);
		expect(opening?.at).toBe(Date.UTC(2026, 0, 2, 3, 0, 1));
		expect(new Set(mapped.events.map((event) => event.eventId)).size).toBe(9);
		expect(mapped.counts.user).toEqual({ rows: 3, mapped: 3, unmapped: 0 });
		expect(mapped.counts.agent).toEqual({ rows: 4, mapped: 4, unmapped: 0 });
	});

	test("rows streamed one content block each map to one agent message each, in order", () => {
		const block = (uuid: string, content: unknown) => ({
			type: "assistant",
			uuid,
			parent_tool_use_id: null,
			message: { id: "msg-1", role: "assistant", content: [content] },
		});
		const mapped = map([
			row("user", "Go", "t-1", 1),
			row(
				"assistant",
				block("u-a", { type: "thinking", thinking: "Hm.", signature: "" }),
				"t-1",
				2,
			),
			row("assistant", block("u-b", { type: "text", text: "Reading." }), "t-1", 3),
			row(
				"assistant",
				block("u-c", { type: "tool_use", id: "tu-1", name: "Read", input: {} }),
				"t-1",
				4,
			),
		]);
		expect(lines(mapped.events)).toEqual([
			"t-1 new_turn: Go",
			"t-1 agent: thinking",
			"t-1 agent: text Reading.",
			"t-1 agent: call Read",
			"t-1 ended: interrupted",
		]);
	});

	test("a sub-agent's calls carry the call that started it, and its text payloads show no bubble", () => {
		const mapped = map([
			row("user", "Go", "t-1", 1),
			row("assistant", call("tu-task", "Task"), "t-1", 2),
			row("assistant", typed("The sub-agent's prompt", "tu-task"), "t-1", 3),
			row("assistant", say("Inside", "tu-task"), "t-1", 4),
			row("assistant", call("tu-grep", "Grep", "tu-task"), "t-1", 5),
			row("assistant", result("tu-grep", "tu-task"), "t-1", 6),
			row("assistant", result("tu-task"), "t-1", 7),
		]);
		expect(lines(mapped.events)).toEqual([
			"t-1 new_turn: Go",
			"t-1 agent: call Task",
			"t-1 agent in tu-task: text Inside",
			"t-1 agent in tu-task: call Grep in tu-task",
			"t-1 agent in tu-task: tool_result",
			"t-1 agent: tool_result",
			"t-1 ended: interrupted",
		]);
		expect(mapped.counts.agent).toEqual({ rows: 6, mapped: 6, unmapped: 0 });
	});

	test("a main-agent user payload with text maps to a steer, as Conductor shows it as a bubble", () => {
		const mixed = {
			type: "user",
			parent_tool_use_id: null,
			message: {
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "tu-1", content: "ok" },
					{ type: "text", text: "And a note" },
				],
			},
		};
		const mapped = map([
			row("user", "Go", "t-1", 1),
			row("assistant", typed("An injected note"), "t-1", 2),
			row("assistant", call("tu-1", "Bash"), "t-1", 3),
			row("assistant", mixed, "t-1", 4),
			row("assistant", result("tu-1"), "t-1", 5),
		]);
		expect(lines(mapped.events)).toEqual([
			"t-1 new_turn: Go",
			"t-1 steer: An injected note",
			"t-1 agent: call Bash",
			"t-1 steer: And a note",
			"t-1 agent: tool_result",
			"t-1 agent: tool_result",
			"t-1 ended: interrupted",
		]);
		expect(new Set(mapped.events.map((event) => event.eventId)).size).toBe(7);
	});

	test("leaves out, and counts, the rows Conductor's chat does not show", () => {
		const mapped = map([
			row("user", "queued", null, null),
			row("assistant", say("An agent-started turn"), "t-0", 1),
			row("user", " /compact ", "t-1", 2),
			row("assistant", { type: "system", subtype: "compact_boundary" }, "t-1", 3),
			row("assistant", say("Compacted"), "t-1", 4),
			row("assistant", typed("/compact"), "t-1", 5),
			row("user", "Next", "t-2", 6),
			row("assistant", say("Compacted"), "t-2", 7),
		]);
		expect(lines(mapped.events)).toEqual([
			"t-1 agent: notice",
			"t-1 ended: interrupted",
			"t-2 new_turn: Next",
			"t-2 agent: text Compacted",
			"t-2 ended: interrupted",
		]);
		expect(mapped.leftOut).toEqual({
			"queued message": 1,
			"turn without a user message": 1,
			"compact command": 2,
			"compacted reply": 1,
		});
		expect(mapped.counts.user).toEqual({ rows: 3, mapped: 3, unmapped: 0 });
		expect(mapped.counts.agent).toEqual({ rows: 5, mapped: 5, unmapped: 0 });
	});

	test("counts the rows it cannot map, by reason, and never throws", () => {
		const mapped = map([
			row("user", "Go", "t-1", 1),
			row("user", "no turn", null, 2),
			row("assistant", "{not json", "t-1", 3),
			row("assistant", "[1, 2]", "t-1", 4),
			row("assistant", { text: "no type" }, "t-1", 5),
			row("assistant", null, "t-1", 6),
			row("SUMMARY", "What happened so far", "t-1", 7),
			row("tool", "{}", "t-1", 8),
			row(null, "{}", "t-1", 9),
			// An assistant payload with no message: the translator fails on it.
			row("assistant", { type: "assistant" }, "t-1", 10),
		]);
		expect(lines(mapped.events)).toEqual(["t-1 new_turn: Go", "t-1 ended: interrupted"]);
		expect(mapped.unmapped).toEqual({
			"no turn": 1,
			unreadable: 4,
			summary: 1,
			"unknown role": 2,
			untranslated: 1,
		});
		expect(mapped.counts).toEqual({
			user: { rows: 2, mapped: 1, unmapped: 1 },
			agent: { rows: 5, mapped: 0, unmapped: 5 },
			summary: { rows: 1, mapped: 0, unmapped: 1 },
			other: { rows: 2, mapped: 0, unmapped: 2 },
		});
	});

	test("an agent row of an agent without a translator counts as unmapped", () => {
		const mapped = map(
			[row("user", "Go", "t-1", 1), row("assistant", say("Hi"), "t-1", 2)],
			"codex",
		);
		expect(lines(mapped.events)).toEqual(["t-1 new_turn: Go", "t-1 ended: interrupted"]);
		expect(mapped.counts.agent).toEqual({ rows: 1, mapped: 0, unmapped: 1 });
		expect(mapped.unmapped.untranslated).toBe(1);
	});

	test("only Claude's payloads are mapped today", () => {
		expect([...MAPPED_AGENTS]).toEqual(["claude"]);
	});

	test("a turn ends as its last result says, as our runner ends one", () => {
		const failed = {
			type: "result",
			subtype: "error_during_execution",
			is_error: true,
			num_turns: 2,
			errors: ["Overloaded"],
		};
		const background = { type: "result", subtype: "success", is_error: false, num_turns: 0 };
		const mapped = map([
			row("user", "Go", "t-1", 1),
			row("assistant", failed, "t-1", 2),
			row("user", "Again", "t-2", 3),
			row("assistant", { type: "result", subtype: "success", is_error: false }, "t-2", 4),
			// A background task's mini result after the turn's own result ends nothing.
			row("assistant", background, "t-2", 5),
			row("user", "Stopped", "t-3", 6),
			row("assistant", say("Half way"), "t-3", 7),
		]);
		const ends = mapped.events.filter((event) => event.type === "turn_ended");
		expect(ends.map((event) => [event.turnId, event.outcome, event.error, event.at])).toEqual([
			["t-1", "error", "Claude Code error: Overloaded", Date.UTC(2026, 0, 2, 3, 0, 2)],
			["t-2", "success", undefined, Date.UTC(2026, 0, 2, 3, 0, 5)],
			["t-3", "interrupted", undefined, Date.UTC(2026, 0, 2, 3, 0, 7)],
		]);
		expect(new Set(ends.map((event) => event.eventId)).size).toBe(3);
	});

	test("a turn that shows nothing gets no end", () => {
		const mapped = map([row("user", "/compact", "t-1", 1)]);
		expect(mapped.events).toEqual([]);
		expect(mapped.leftOut["compact command"]).toBe(1);
	});
});

/** Rows of a chat that exercises every rule, in the table's order: the order they were written. */
function everyRule(): ConductorMessageRow[] {
	return [
		row("user", "First", "t-1", 1),
		row("assistant", say("One"), "t-1", 2),
		row("user", "Steer", "t-1", 3),
		row("assistant", call("tu-task", "Task"), "t-1", 4),
		row("assistant", say("Inside", "tu-task"), "t-1", 5),
		row("assistant", result("tu-task"), "t-1", 6, 1),
		row("assistant", { type: "result", subtype: "success", is_error: false }, "t-1", 7),
		row("assistant", say("An agent-started turn"), "t-0", 8),
		row("user", "/compact", "t-2", 9),
		// The reply comes before the compaction that hides it, so a read may cut between them.
		row("assistant", say("Compacted"), "t-2", 10),
		row("assistant", say("Still shown"), "t-2", 11),
		row("assistant", { type: "system", subtype: "compact_boundary" }, "t-2", 12),
		row("assistant", say("Compacted"), "t-2", 13),
		row("user", "Later", "t-3", 14),
		row("assistant", say("Compacted"), "t-3", 15),
		row("assistant", "{broken", "t-3", 16),
		row("SUMMARY", "So far", "t-3", 17),
		row("user", "no turn", null, 18),
		row("user", "queued", null, null),
		// Sent before "Later" though stored after it: it sorts by its sent time.
		row("assistant", say("Early"), "t-3", 14, 13),
	];
}

/** Maps rows through the two reads, giving each read's rows reversed, as a database may. */
function mapInReads(rows: readonly ConductorMessageRow[], budget: ReadBudget) {
	const placed: ConductorPlacedRow[] = rows.map((one, rowid) => ({ ...one, rowid: rowid + 10 }));
	const mapper = new ConductorHistoryMapper({ agent: "claude", config: CONFIG });
	const keys = placed.map((one) => ({
		rowid: one.rowid,
		role: one.role,
		turn_id: one.turn_id,
		sent_at: one.sent_at,
		created_at: one.created_at,
		chars: one.content?.length ?? 0,
	}));
	// The first read comes in pages, in the table's order.
	for (let start = 0; start < keys.length; start += 3) {
		expect(mapper.addKeys(keys.slice(start, start + 3)).ok).toBe(true);
	}
	const events: SessionEvent[] = [];
	let reads = 0;
	for (;;) {
		const next = mapper.nextRead(budget);
		if (!next.ok) throw new Error(next.error);
		if (next.value === null) break;
		reads++;
		expect(next.value.length).toBeLessThanOrEqual(budget.rows);
		const wanted = new Set(next.value);
		const mapped = mapper.map(placed.filter((one) => wanted.has(one.rowid)).reverse());
		if (!mapped.ok) throw new Error(mapped.error);
		events.push(...mapped.value);
	}
	return { events, reads, ...mapper.summary() };
}

describe("APP-18 the mapping in reads of a budget", () => {
	test("any budget and any order within a read give the events of the whole chat", () => {
		const rows = everyRule();
		const whole = mapConductorMessages(rows, { agent: "claude", config: CONFIG });
		expect(lines(whole.events)).toEqual([
			"t-1 new_turn: First",
			"t-1 agent: text One",
			"t-1 steer: Steer",
			"t-1 agent: call Task",
			"t-1 agent in tu-task: text Inside",
			"t-1 agent: tool_result",
			"t-1 agent: usage",
			"t-1 ended: success",
			"t-2 agent: text Still shown",
			"t-2 agent: notice",
			"t-2 ended: interrupted",
			"t-3 agent: text Early",
			"t-3 new_turn: Later",
			"t-3 agent: text Compacted",
			"t-3 ended: interrupted",
		]);
		for (const budget of [
			{ rows: 1, chars: Number.POSITIVE_INFINITY },
			{ rows: 2, chars: Number.POSITIVE_INFINITY },
			{ rows: 5, chars: Number.POSITIVE_INFINITY },
			{ rows: 1000, chars: 1 },
			{ rows: 1000, chars: 200 },
		]) {
			const paged = mapInReads(rows, budget);
			expect({ budget, events: paged.events }).toEqual({ budget, events: whole.events });
			expect(paged.counts).toEqual(whole.counts);
			expect(paged.unmapped).toEqual(whole.unmapped);
			expect(paged.leftOut).toEqual(whole.leftOut);
		}
		expect(mapInReads(rows, { rows: 1, chars: 1 }).reads).toBe(17);
		expect(whole.leftOut).toEqual({
			"queued message": 1,
			"turn without a user message": 1,
			"compact command": 1,
			"compacted reply": 2,
		});
	});

	test("a row missing from a read fails the chat, and the order of calls is held", () => {
		const placed = everyRule().map((one, rowid) => ({ ...one, rowid }));
		const mapper = new ConductorHistoryMapper({ agent: "claude", config: CONFIG });
		expect(mapper.map([]).ok).toBe(false);
		mapper.addKeys(
			placed.map((one) => ({ ...one, chars: 0 })).map(({ content: _content, ...key }) => key),
		);
		const next = mapper.nextRead({ rows: 4, chars: Number.POSITIVE_INFINITY });
		expect(next.ok && next.value?.length).toBe(4);
		expect(mapper.nextRead({ rows: 4, chars: 1 }).ok).toBe(false);
		expect(mapper.addKeys([]).ok).toBe(false);
		const wanted = new Set(next.ok ? next.value : []);
		const missing = mapper.map(placed.filter((one) => wanted.has(one.rowid)).slice(1));
		expect(missing.ok).toBe(false);
	});
});
