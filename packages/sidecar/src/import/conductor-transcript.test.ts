import { describe, expect, test } from "bun:test";
import type { ConductorMessageRow } from "./conductor-history.ts";
import {
	compareTranscripts,
	conductorTranscript,
	type TranscriptTurn,
} from "./conductor-transcript.ts";

describe("APP-18 what Conductor's chat shows of a chat", () => {
	test("reads the visible messages of a chat from the rows Conductor reads", () => {
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

	test("hides a text-only sign-in message when the turn's result is a sign-in error (kpa, CQi, JVt)", () => {
		const signIn = "Invalid API key · Please run /login";
		const failedSignIn = { type: "result", subtype: "success", is_error: true, result: signIn };
		expect(
			conductorTranscript([
				message("user", "Go", "t-1", "2026-01-02 03:00:00"),
				message("assistant", say(signIn), "t-1", "2026-01-02 03:00:01"),
				message("assistant", failedSignIn, "t-1", "2026-01-02 03:00:02"),
				message("user", "Again", "t-2", "2026-01-02 04:00:00"),
				message("assistant", say(signIn), "t-2", "2026-01-02 04:00:01"),
			]),
		).toEqual([
			{ user: ["Go"], agent: [] },
			// No sign-in result in this turn, so Conductor shows the text.
			{ user: ["Again"], agent: [{ kind: "text", text: signIn }] },
		]);
	});

	test("a turn that holds only a typed /compact shows nothing, so it is not a turn a reader sees (Zft, AW)", () => {
		expect(
			conductorTranscript([
				message("user", "Fix it", "t-1", "2026-01-02 03:00:00"),
				message("assistant", say("Fixed."), "t-1", "2026-01-02 03:00:01"),
				message("user", "/compact", "t-2", "2026-01-02 04:00:00"),
				message("user", "Thanks", "t-3", "2026-01-02 05:00:00"),
			]),
		).toEqual([
			{ user: ["Fix it"], agent: [{ kind: "text", text: "Fixed." }] },
			{ user: ["Thanks"], agent: [] },
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
