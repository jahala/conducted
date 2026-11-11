import { describe, expect, test } from "bun:test";
import type { SessionConfig } from "@conducted/protocol";
import {
	type ConductorEventRow,
	type ConductorMessageRow,
	compareTranscripts,
	conductorTranscript,
	MAPPED_AGENTS,
	mapConductorEvents,
	type TranscriptTurn,
} from "./conductor-events.ts";

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

const row = (
	event_type: string | null,
	content: unknown,
	extra: Partial<ConductorEventRow> = {},
) => ({
	event_id: `e-${Math.random().toString(36).slice(2)}`,
	event_type,
	content: typeof content === "string" ? content : JSON.stringify(content),
	received_at: "2026-01-02 03:04:05",
	reverted_at: null,
	...extra,
});

const assistant = (text: string) => ({
	type: "agent",
	turnId: "t-1",
	rawPayload: {
		type: "assistant",
		uuid: "u-1",
		session_id: "claude-1",
		parent_tool_use_id: null,
		message: { role: "assistant", content: [{ type: "text", text }] },
	},
});

describe("APP-18 Conductor's chat events as ours", () => {
	test("a Claude assistant payload maps to one agent event whose items are its text", () => {
		const mapped = mapConductorEvents([row("agent", assistant("Hello there"))], {
			agent: "claude",
			config: CONFIG,
		});
		expect(mapped.events).toHaveLength(1);
		const event = mapped.events[0];
		expect(event?.type).toBe("agent");
		if (event?.type !== "agent") return;
		expect(event.turnId as string).toBe("t-1");
		expect(event.message.items).toEqual([{ kind: "text", text: "Hello there" }]);
		expect(event.at).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
		expect(mapped.counts.agent).toEqual({ events: 1, mapped: 1, unmapped: 0 });
	});

	test("a sent user message maps, and a queued one is understood but shows nothing", () => {
		const mapped = mapConductorEvents(
			[
				row("userMessage", { id: "m-1", text: "Fix it", state: "queued" }),
				row("userMessage", { id: "m-1", text: "Fix it", state: "sent", turnId: "t-9" }),
				row("agent", { ...assistant("Done"), turnId: undefined }),
			],
			{ agent: "claude", config: CONFIG },
		);
		expect(mapped.counts.userMessage).toEqual({ events: 2, mapped: 2, unmapped: 0 });
		expect(mapped.events.map((event) => event.type)).toEqual(["user_message", "agent"]);
		expect(mapped.events[1]?.type === "agent" && (mapped.events[1].turnId as string)).toBe("t-9");
		expect(mapped.events[0]?.type === "user_message" && mapped.events[0].text).toBe("Fix it");
	});

	test("counts what it cannot map and never throws", () => {
		const mapped = mapConductorEvents(
			[
				row("agent", "{not json"),
				row("agent", { type: "agent", rawPayload: "text" }),
				row("checkpointCreated", { type: "checkpointCreated", phase: "start" }),
				row("somethingNew", { a: 1 }),
				row(null, null),
				row("agent", assistant("gone"), { reverted_at: "2026-01-03 00:00:00" }),
			],
			{ agent: "claude", config: CONFIG },
		);
		expect(mapped.events).toEqual([]);
		expect(mapped.counts.agent).toEqual({ events: 2, mapped: 0, unmapped: 2 });
		expect(mapped.counts.checkpointCreated).toEqual({ events: 1, mapped: 0, unmapped: 1 });
		expect(mapped.counts.other).toEqual({ events: 2, mapped: 0, unmapped: 2 });
		expect(mapped.reverted).toBe(1);
	});

	test("an agent payload of an agent without a translator counts as unmapped", () => {
		const mapped = mapConductorEvents([row("agent", assistant("Hi"))], {
			agent: "codex",
			config: { ...CONFIG, agent: "codex" },
		});
		expect(mapped.counts.agent).toEqual({ events: 1, mapped: 0, unmapped: 1 });
	});

	test("reads Conductor's visible messages from its projection", () => {
		expect(
			conductorTranscript([
				message("user", "Fix   the\ntest", "t-1", "2026-01-02 03:00:00"),
				message("assistant", say("Looking."), "t-1", "2026-01-02 03:00:01"),
				message("assistant", call("tu-1", "Read"), "t-1", "2026-01-02 03:00:02"),
				message("assistant", result("tu-1"), "t-1", "2026-01-02 03:00:03"),
				message("assistant", { type: "result", is_error: false }, "t-1", "2026-01-02 03:00:04"),
				message("assistant", say("Done."), "t-1", "2026-01-02 03:00:05"),
				message("user", "queued, not sent", "t-2", null),
				message("SUMMARY", "a summary", "t-1", "2026-01-02 03:00:06"),
			]),
		).toEqual([
			{
				user: ["Fix the test"],
				agent: [
					{ kind: "text", text: "Looking." },
					{ kind: "tool", name: "Read" },
					{ kind: "text", text: "Done." },
				],
			},
		]);
	});

	test("one message per row: streamed text blocks, steers and turns keep Conductor's order", () => {
		const transcript = conductorTranscript([
			message("user", "Second", "t-2", "2026-01-02 04:00:00"),
			message("assistant", say("Reply two"), "t-2", "2026-01-02 04:00:01"),
			message("user", "First", "t-1", "2026-01-02 03:00:00"),
			message("assistant", say("Part one"), "t-1", "2026-01-02 03:00:01"),
			message("assistant", say("   "), "t-1", "2026-01-02 03:00:02"),
			message("user", "Steer it", "t-1", "2026-01-02 03:00:03"),
			message("assistant", say("Part two"), "t-1", "2026-01-02 03:00:04"),
			message("assistant", say("orphan"), "t-9", "2026-01-02 03:00:05"),
		]);
		expect(transcript.map((turn) => turn.user)).toEqual([["First", "Steer it"], ["Second"]]);
		expect(transcript[0]?.agent).toEqual([
			{ kind: "text", text: "Part one" },
			{ kind: "text", text: "Part two" },
		]);
		expect(transcript[1]?.agent).toEqual([{ kind: "text", text: "Reply two" }]);
	});

	test("a sub-agent's messages sit under its call, and compaction rows show as Conductor shows them", () => {
		const rows = [
			message("user", "Go", "t-1", "2026-01-02 03:00:00"),
			message("assistant", call("tu-task", "Task"), "t-1", "2026-01-02 03:00:01"),
			message("assistant", say("inner", "tu-task"), "t-1", "2026-01-02 03:00:02"),
			message("assistant", call("tu-inner", "Bash", "tu-task"), "t-1", "2026-01-02 03:00:03"),
			message(
				"assistant",
				{ type: "system", subtype: "compact_boundary" },
				"t-1",
				"2026-01-02 03:00:04",
			),
			message("assistant", say("Compacted"), "t-1", "2026-01-02 03:00:05"),
			message("assistant", user("/compact"), "t-1", "2026-01-02 03:00:06"),
			message("assistant", user("Injected note"), "t-1", "2026-01-02 03:00:07"),
			message("assistant", "{not json", "t-1", "2026-01-02 03:00:08"),
		];
		expect(conductorTranscript(rows)).toEqual([
			{ user: ["Go", "Injected note"], agent: [{ kind: "tool", name: "Task" }] },
		]);
		expect(conductorTranscript(rows, { subAgentText: "inline" })[0]?.agent).toEqual([
			{ kind: "tool", name: "Task" },
			{ kind: "text", text: "inner" },
		]);
	});

	test("compares transcripts by content and names the first difference", () => {
		const rows = [
			message("user", "Go", "t-1", "2026-01-02 03:00:00"),
			message("assistant", say("Working"), "t-1", "2026-01-02 03:00:01"),
			message("assistant", call("tu-1", "Bash"), "t-1", "2026-01-02 03:00:02"),
			message("assistant", say("inner", "tu-1"), "t-1", "2026-01-02 03:00:03"),
		];
		const same: TranscriptTurn[] = [
			{
				user: ["Go"],
				agent: [
					{ kind: "text", text: "Working" },
					{ kind: "tool", name: "Bash" },
				],
			},
		];
		const turn = same[0] as TranscriptTurn;
		expect(compareTranscripts(rows, same)).toBe("match");
		expect(compareTranscripts(rows, [{ ...turn, user: ["Went"] }])).toBe("user text");
		expect(
			compareTranscripts(rows, [
				{ ...turn, agent: [{ kind: "text", text: "Working!" }, turn.agent[1] as never] },
			]),
		).toBe("agent text");
		expect(compareTranscripts(rows, [{ ...turn, agent: [turn.agent[0] as never] }])).toBe(
			"tool calls",
		);
		expect(compareTranscripts(rows, [turn, { user: ["More"], agent: [] }])).toBe("turns");
		expect(compareTranscripts(rows, [])).toBe("nothing shown");
		expect(
			compareTranscripts(rows, [
				{ ...turn, agent: [...turn.agent, { kind: "text", text: "inner" }] },
			]),
		).toBe("sub-agent text");
	});

	test("only Claude's payloads are mapped today", () => {
		expect([...MAPPED_AGENTS]).toEqual(["claude"]);
	});
});

let rowNumber = 0;
function message(
	role: string,
	content: unknown,
	turn_id: string | null,
	sent_at: string | null,
): ConductorMessageRow {
	rowNumber++;
	return {
		id: `sm-${rowNumber}`,
		role,
		content: typeof content === "string" ? content : JSON.stringify(content),
		sent_at,
		created_at: sent_at ?? "2026-01-02 00:00:00",
		turn_id,
	};
}

const say = (text: string, parent: string | null = null) => ({
	type: "assistant",
	parent_tool_use_id: parent,
	message: { role: "assistant", content: [{ type: "text", text }] },
});

const call = (id: string, name: string, parent: string | null = null) => ({
	type: "assistant",
	parent_tool_use_id: parent,
	message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] },
});

const result = (toolUseId: string) => ({
	type: "user",
	parent_tool_use_id: null,
	message: {
		role: "user",
		content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }],
	},
});

const user = (text: string) => ({
	type: "user",
	parent_tool_use_id: null,
	message: { role: "user", content: [{ type: "text", text }] },
});
