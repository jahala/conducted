import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONDUCTOR_FIXTURE_SCHEMA } from "../../apps/desktop/src/test/conductor-schema.ts";

const SPIKE = join(import.meta.dir, "spike.ts");

/** The reasons a mismatch may give, all fixed words. */
const MISMATCHES = [
	"turn count",
	"user text",
	"agent text",
	"tool calls",
	"sub-agent text in the main transcript",
	"Conducted shows nothing",
].join("|");

/** Values seeded into the database that must never reach the spike's output. */
const SEEDED = [
	"secret-user-text-1",
	"secret-assistant-text-2",
	"secret-title-3",
	"/Users/someone/secret-path-4",
	"secret-model-5",
	"claude-session-secret-6",
	"secretEventType7",
	"s-secret-id-8",
];

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "conducted-spike-test-"));
	dirs.push(dir);
	const path = join(dir, "conductor.db");
	const db = new Database(path);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec(CONDUCTOR_FIXTURE_SCHEMA);
	const session = db.prepare(
		"INSERT INTO sessions (id, workspace_id, agent_type, model, title, claude_session_id) VALUES (?, ?, ?, ?, ?, ?)",
	);
	session.run(
		"s-secret-id-8",
		"w-1",
		"claude",
		"secret-model-5",
		"secret-title-3",
		"claude-session-secret-6",
	);
	session.run("s-two", "w-1", null, "secret-model-5", "secret-title-3", null);
	session.run("s-codex", "w-1", "codex", "secret-model-5", "secret-title-3", null);
	session.run("s-empty", "w-1", "claude", null, null, null);
	const event = db.prepare(
		"INSERT INTO session_events (session_id, session_index, event_id, event_type, content, received_at, reverted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
	);
	const user = JSON.stringify({
		id: "m-1",
		text: "secret-user-text-1",
		state: "sent",
		turnId: "t-1",
	});
	const agent = JSON.stringify({
		type: "agent",
		turnId: "t-1",
		rawPayload: {
			type: "assistant",
			uuid: "u-1",
			session_id: "claude-session-secret-6",
			parent_tool_use_id: null,
			message: { role: "assistant", content: [{ type: "text", text: "secret-assistant-text-2" }] },
		},
	});
	event.run("s-secret-id-8", 0, "e-1", "userMessage", user, "2026-01-02 03:04:05", null);
	event.run("s-secret-id-8", 1, "e-2", "agent", agent, "2026-01-02 03:04:06", null);
	event.run(
		"s-secret-id-8",
		2,
		"e-3",
		"secretEventType7",
		'{"x":"/Users/someone/secret-path-4"}',
		null,
		null,
	);
	event.run("s-secret-id-8", 3, "e-4", "agent", "{broken secret-assistant-text-2", null, null);
	event.run("s-two", 0, "e-5", "userMessage", user, null, null);
	event.run("s-two", 1, "e-6", "agent", agent, null, "2026-01-03 00:00:00");
	event.run("s-codex", 0, "e-7", "userMessage", user, null, null);
	event.run("s-codex", 1, "e-8", "agent", agent, null, null);
	const message = db.prepare(
		"INSERT INTO session_messages (id, session_id, role, content, sent_at, turn_id) VALUES (?, ?, ?, ?, ?, ?)",
	);
	const reply = JSON.stringify(JSON.parse(agent).rawPayload);
	for (const chat of ["s-secret-id-8", "s-two", "s-codex"]) {
		message.run(`${chat}-1`, chat, "user", "secret-user-text-1", "2026-01-02 03:04:05", "t-1");
		message.run(`${chat}-2`, chat, "assistant", reply, "2026-01-02 03:04:06", "t-1");
	}
	db.close();
	return { dir, path };
}

/**
 * A database of made-up chats whose transcript is known by hand. Each chat holds the same two
 * turns in both of Conductor's tables: user messages, assistant text, tool-only assistant rows,
 * tool results and a result row. An altered chat changes one text block in `session_messages`.
 */
function knownCase(chats: { id: string; agent: string; altered: boolean }[]): {
	dir: string;
	path: string;
} {
	const dir = mkdtempSync(join(tmpdir(), "conducted-spike-test-"));
	dirs.push(dir);
	const path = join(dir, "conductor.db");
	const db = new Database(path);
	db.exec(CONDUCTOR_FIXTURE_SCHEMA);
	const session = db.prepare(
		"INSERT INTO sessions (id, workspace_id, agent_type) VALUES (?, ?, ?)",
	);
	const event = db.prepare(
		"INSERT INTO session_events (session_id, session_index, event_id, event_type, content, received_at, reverted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
	);
	const message = db.prepare(
		"INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
	);
	const text = (value: string) => ({
		type: "assistant",
		uuid: `u-${value.length}`,
		session_id: "claude-1",
		parent_tool_use_id: null,
		message: { role: "assistant", content: [{ type: "text", text: value }] },
	});
	const toolUse = (id: string, name: string, input: unknown) => ({
		type: "assistant",
		uuid: `u-${id}`,
		session_id: "claude-1",
		parent_tool_use_id: null,
		message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
	});
	const toolResult = (id: string, output: string) => ({
		type: "user",
		uuid: `r-${id}`,
		session_id: "claude-1",
		parent_tool_use_id: null,
		message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: output }] },
	});
	const done = {
		type: "result",
		subtype: "success",
		is_error: false,
		result: "Fixed. The test passes now.",
		total_cost_usd: 0.01,
		usage: { input_tokens: 10, output_tokens: 5 },
	};
	const turns: { turnId: string; user: string; replies: unknown[] }[] = [
		{
			turnId: "t-1",
			user: "Please fix the failing test.",
			replies: [
				text("I will read the test first."),
				toolUse("tu-1", "Read", { file_path: "src/a.test.ts" }),
				toolResult("tu-1", "expect(sum(1, 1)).toBe(3);"),
				toolUse("tu-2", "Edit", { file_path: "src/a.test.ts", old_string: "3", new_string: "2" }),
				toolResult("tu-2", "The file was edited."),
				text("Fixed.  The test\npasses now."),
				done,
			],
		},
		{ turnId: "t-2", user: "Thanks!", replies: [text("Glad to help.")] },
	];
	for (const chat of chats) {
		session.run(chat.id, "w-1", chat.agent);
		let index = 0;
		let second = 0;
		const at = () => `2026-01-02 03:04:${String(second++).padStart(2, "0")}`;
		for (const turn of turns) {
			const sent = at();
			event.run(
				chat.id,
				index,
				`${chat.id}-e-${index}`,
				"userMessage",
				JSON.stringify({
					id: `${chat.id}-${turn.turnId}`,
					text: turn.user,
					state: "sent",
					turnId: turn.turnId,
				}),
				sent,
			);
			message.run(`${chat.id}-m-${index}`, chat.id, "user", turn.user, sent, sent, turn.turnId);
			index++;
			for (const reply of turn.replies) {
				const sentAt = at();
				event.run(
					chat.id,
					index,
					`${chat.id}-e-${index}`,
					"agent",
					JSON.stringify({ type: "agent", turnId: turn.turnId, rawPayload: reply }),
					sentAt,
				);
				const shown =
					chat.altered && reply === turns[0]?.replies[5]
						? text("Fixed. The test fails now.")
						: reply;
				message.run(
					`${chat.id}-m-${index}`,
					chat.id,
					"assistant",
					JSON.stringify(shown),
					sentAt,
					sentAt,
					turn.turnId,
				);
				index++;
			}
		}
	}
	db.close();
	return { dir, path };
}

function runSpike(args: string[]): { code: number; out: string } {
	const run = Bun.spawnSync(["bun", SPIKE, ...args], { stdout: "pipe", stderr: "pipe" });
	return { code: run.exitCode, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

/**
 * Every line the spike may print: fixed words, counts, percentages, the event type names, the
 * agent names and the fixed results.
 */
const LINE = new RegExp(
	[
		"^$",
		"^Conductor chat history spike: counts only$",
		"^chats with events: \\d+$",
		"^chats sampled: \\d+$",
		"^chats by agent \\(sampled, match, mismatch, not mapped yet\\):$",
		"^  (claude|codex|cursor|acp|other) \\d+ \\d+ \\d+ \\d+$",
		"^chats not mapped yet are left out of the pass mark\\.$",
		"^events by type in mapped chats \\(events, mapped, unmapped\\):$",
		"^  (userMessage|agent|checkpointCreated|other) \\d+ \\d+ \\d+$",
		"^all events in mapped chats: \\d+, mapped: \\d+ \\(\\d+\\.\\d%\\)$",
		"^events in chats not mapped yet: \\d+$",
		"^reverted events left out: \\d+$",
		"^per chat \\(agent; Conductor turns, entries; Conducted turns, entries; result\\):$",
		`^  chat \\d+: (claude|codex|cursor|acp|other) \\d+ \\d+ \\d+ \\d+ (match|not mapped yet|mismatch \\((${MISMATCHES})\\))$`,
		"^mapped chats whose transcript matches: \\d+ of \\d+$",
		"^pass mark \\(at least 99% of events mapped and every mapped chat matching\\): (met|not met)$",
	].join("|"),
);

describe("APP-18 the chat history spike", () => {
	test("prints counts only, never a value from the database", () => {
		const { path } = fixture();
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		for (const value of SEEDED) expect(out).not.toContain(value);
		for (const line of out.split("\n")) expect(line).toMatch(LINE);
		expect(out).toContain("chats with events: 3");
		expect(out).toContain("chats sampled: 3");
		expect(out).toContain("  userMessage 2 2 0");
		expect(out).toContain("  agent 2 1 1");
		expect(out).toContain("  other 1 0 1");
		expect(out).toContain("reverted events left out: 1");
		expect(out).toContain("events in chats not mapped yet: 2");
		expect(out).toContain("  chat 1: codex 1 2 0 0 not mapped yet");
		expect(out).toContain("  chat 2: claude 1 2 1 2 match");
		expect(out).toContain("  chat 3: claude 1 2 1 1 mismatch (agent text)");
		expect(out).toContain("  claude 2 1 1 0");
		expect(out).toContain("  codex 1 0 0 1");
	});

	test("checks itself on a known chat: the hand-built one matches, an altered copy does not, Codex is apart", () => {
		const { path } = knownCase([
			{ id: "k-1", agent: "claude", altered: false },
			{ id: "k-2", agent: "claude", altered: true },
			{ id: "k-3", agent: "codex", altered: false },
		]);
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		for (const line of out.split("\n")) expect(line).toMatch(LINE);
		// Counted by hand: turn 1 shows the user's message, two texts and the Read and Edit cards;
		// turn 2 shows the user's message and one text. The tool results and the result row add none.
		expect(out).toContain("  chat 1: claude 2 7 2 7 match");
		expect(out).toContain("  chat 2: claude 2 7 2 7 mismatch (agent text)");
		expect(out).toContain("  chat 3: codex 2 7 0 0 not mapped yet");
		expect(out).toContain("all events in mapped chats: 20, mapped: 20 (100.0%)");
		expect(out).toContain("events in chats not mapped yet: 10");
		expect(out).toContain("mapped chats whose transcript matches: 1 of 2");
		expect(out).toContain(": not met");
	});

	test("meets the pass mark when every mapped chat reads the same, with a Codex chat left out", () => {
		const { path } = knownCase([
			{ id: "k-1", agent: "claude", altered: false },
			{ id: "k-3", agent: "codex", altered: false },
		]);
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		expect(out).toContain("mapped chats whose transcript matches: 1 of 1");
		expect(out).toContain(
			"pass mark (at least 99% of events mapped and every mapped chat matching): met",
		);
	});

	test("leaves the copy's folder as it was", () => {
		const { dir, path } = fixture();
		const before = readdirSync(dir).sort();
		expect(runSpike([path]).code).toBe(0);
		expect(readdirSync(dir).sort()).toEqual(before);
	});

	test("a path that is not a database fails without naming it", () => {
		const { dir } = fixture();
		const missing = join(dir, "secret-path-4", "conductor.db");
		const { code, out } = runSpike([missing]);
		expect(code).not.toBe(0);
		expect(out).not.toContain("secret-path-4");
	});
});
