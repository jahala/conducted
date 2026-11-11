import { describe, expect, test } from "bun:test";
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import {
	type ConductorMessageRow,
	MAPPED_AGENTS,
	mapConductorMessages,
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
			"t-2 new_turn: Second",
			"t-2 agent: text Reply two",
		]);
		const opening = mapped.events[0];
		expect(opening?.type === "user_message" && (opening.messageId as string)).toBe(first.id);
		expect(opening?.at).toBe(Date.UTC(2026, 0, 2, 3, 0, 1));
		expect(new Set(mapped.events.map((event) => event.eventId)).size).toBe(7);
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
		]);
		expect(new Set(mapped.events.map((event) => event.eventId)).size).toBe(6);
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
			"t-2 new_turn: Next",
			"t-2 agent: text Compacted",
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
		expect(lines(mapped.events)).toEqual(["t-1 new_turn: Go"]);
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
		expect(lines(mapped.events)).toEqual(["t-1 new_turn: Go"]);
		expect(mapped.counts.agent).toEqual({ rows: 1, mapped: 0, unmapped: 1 });
		expect(mapped.unmapped.untranslated).toBe(1);
	});

	test("only Claude's payloads are mapped today", () => {
		expect([...MAPPED_AGENTS]).toEqual(["claude"]);
	});
});
