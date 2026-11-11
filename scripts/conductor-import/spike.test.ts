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
	"secretRole7",
	"s-secret-id-8",
	"secret-turn-9",
];

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function newDatabase(): { dir: string; path: string; db: Database } {
	const dir = mkdtempSync(join(tmpdir(), "conducted-spike-test-"));
	dirs.push(dir);
	const path = join(dir, "conductor.db");
	const db = new Database(path);
	db.exec(CONDUCTOR_FIXTURE_SCHEMA);
	return { dir, path, db };
}

function fixture(): { dir: string; path: string } {
	const { dir, path, db } = newDatabase();
	db.exec("PRAGMA journal_mode = WAL");
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
	session.run("s-events-only", "w-1", "claude", null, null, null);
	db.prepare(
		"INSERT INTO session_events (session_id, session_index, event_id, event_type, content, received_at, reverted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
	).run(
		"s-events-only",
		0,
		"e-1",
		"userMessage",
		'{"text":"secret-user-text-1"}',
		"2026-01-02 03:04:05",
		null,
	);
	const reply = JSON.stringify({
		type: "assistant",
		uuid: "u-1",
		session_id: "claude-session-secret-6",
		parent_tool_use_id: null,
		message: { role: "assistant", content: [{ type: "text", text: "secret-assistant-text-2" }] },
	});
	const message = db.prepare(
		"INSERT INTO session_messages (id, session_id, role, content, sent_at, turn_id) VALUES (?, ?, ?, ?, ?, ?)",
	);
	for (const chat of ["s-secret-id-8", "s-two", "s-codex"]) {
		message.run(
			`${chat}-1`,
			chat,
			"user",
			"secret-user-text-1",
			"2026-01-02T03:04:05.000Z",
			"secret-turn-9",
		);
		message.run(`${chat}-2`, chat, "assistant", reply, "2026-01-02T03:04:06.000Z", "secret-turn-9");
	}
	message.run(
		"s-secret-id-8-3",
		"s-secret-id-8",
		"secretRole7",
		'{"x":"/Users/someone/secret-path-4"}',
		"2026-01-02T03:04:07.000Z",
		"secret-turn-9",
	);
	message.run(
		"s-secret-id-8-4",
		"s-secret-id-8",
		"assistant",
		"{broken secret-assistant-text-2",
		"2026-01-02T03:04:08.000Z",
		"secret-turn-9",
	);
	// A queued message: not in Conductor's chat, so the spike never reads it.
	message.run("s-two-3", "s-two", "user", "secret-user-text-1", null, null);
	db.close();
	return { dir, path };
}

// Claude SDK payloads, as Conductor stores them in an assistant row's content.
const assistant = (uuid: string, content: unknown[], parent: string | null = null) => ({
	type: "assistant",
	uuid,
	session_id: "claude-1",
	parent_tool_use_id: parent,
	message: { id: `msg-${uuid}`, role: "assistant", content },
});
const text = (uuid: string, value: string, parent: string | null = null) =>
	assistant(uuid, [{ type: "text", text: value }], parent);
const toolUse = (id: string, name: string, input: unknown, parent: string | null = null) =>
	assistant(`u-${id}`, [{ type: "tool_use", id, name, input }], parent);
const toolResult = (id: string, output: string, parent: string | null = null) => ({
	type: "user",
	uuid: `r-${id}`,
	session_id: "claude-1",
	parent_tool_use_id: parent,
	message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: output }] },
});
const done = (result: string) => ({
	type: "result",
	subtype: "success",
	is_error: false,
	result,
	total_cost_usd: 0.01,
	usage: { input_tokens: 10, output_tokens: 5 },
});

/** One API message streamed as one row per content block, all with the same message id. */
const streamed = (blocks: unknown[]) =>
	blocks.map((block, index) => ({
		type: "assistant",
		uuid: `u-stream-${index}`,
		session_id: "claude-1",
		parent_tool_use_id: null,
		message: { id: "msg-streamed", role: "assistant", content: [block] },
	}));

type Row = { role: "user"; text: string } | { role: "assistant"; payload: unknown };
const said = (value: string): Row => ({ role: "user", text: value });
const wrote = (payload: unknown): Row => ({ role: "assistant", payload });

/**
 * The rows of a made-up chat, in the order Conductor's writer stores them (main @1574435, `Ppe`):
 * a row per user message, and a row per agent payload it keeps (`kpe` @1570433), which drops a
 * user payload that holds no tool result. The SDK streams one row per content block, so an API
 * message with thinking, text and a call is three rows. A local command's output is stored as
 * assistant text (`NW` @1574397), so the reply to `/compact` is the one-word text "Compacted".
 */
const TURNS: { turnId: string; rows: Row[] }[] = [
	{
		turnId: "t-1",
		rows: [
			said("Please fix the failing test."),
			...streamed([
				{ type: "thinking", thinking: "Read it first.", signature: "" },
				{ type: "text", text: "I will read the test first." },
				{ type: "tool_use", id: "tu-1", name: "Read", input: { file_path: "src/a.test.ts" } },
			]).map(wrote),
			wrote(toolResult("tu-1", "expect(sum(1, 1)).toBe(3);")),
			said("Also check the other test."),
			wrote(toolUse("tu-task", "Task", { description: "Check b", prompt: "Check b.test.ts" })),
			wrote(text("u-sub-1", "Looking at the other test.", "tu-task")),
			wrote(toolUse("tu-grep", "Grep", { pattern: "sum" }, "tu-task")),
			wrote(toolResult("tu-grep", "b.test.ts:3", "tu-task")),
			wrote(toolResult("tu-task", "The other test passes.")),
			wrote(
				toolUse("tu-2", "Edit", { file_path: "src/a.test.ts", old_string: "3", new_string: "2" }),
			),
			wrote(toolResult("tu-2", "The file was edited.")),
			wrote(text("u-2", "Fixed.  The test\npasses now.")),
			wrote(done("Fixed. The test passes now.")),
		],
	},
	{
		turnId: "t-2",
		rows: [
			said("/compact"),
			wrote({ type: "system", subtype: "status", status: "compacting", session_id: "claude-1" }),
			wrote({
				type: "system",
				subtype: "compact_boundary",
				session_id: "claude-1",
				compact_metadata: { trigger: "manual", pre_tokens: 1000 },
			}),
			wrote(text("u-3", "Compacted")),
			wrote(done("")),
		],
	},
	{
		turnId: "t-3",
		rows: [said("Thanks!"), wrote(text("u-4", "Glad to help.")), wrote(done("Glad to help."))],
	},
];

/**
 * A chat whose first turn starts a background helper (a Task call that returns at once). The
 * helper's text, call and result, and the SDK's finish notice for it, are stored under the next
 * turn, as Conductor's writer stores a row under the turn running when it arrives (main `Mmt`
 * @1440847). Conductor builds each turn from its own rows, so that late work shows in neither
 * turn's main transcript (`wp` @1423850, `_mt` @1427823). Ours shows it inside turn one's card
 * (D129), also outside the main transcript.
 */
const BACKGROUND_TURNS: { turnId: string; rows: Row[] }[] = [
	{
		turnId: "t-1",
		rows: [
			said("Start a helper on the other test."),
			wrote(
				toolUse("tu-bg", "Task", {
					description: "Check b",
					prompt: "Check b.test.ts",
					run_in_background: true,
				}),
			),
			wrote(toolResult("tu-bg", "Async agent launched successfully.")),
			wrote(text("u-bg-1", "The helper is running.")),
			wrote(done("The helper is running.")),
		],
	},
	{
		turnId: "t-2",
		rows: [
			said("Anything new?"),
			wrote(text("u-late-1", "Looking at the other test.", "tu-bg")),
			wrote(toolUse("tu-late", "Grep", { pattern: "sum" }, "tu-bg")),
			wrote(toolResult("tu-late", "b.test.ts:3", "tu-bg")),
			wrote({
				type: "system",
				subtype: "task_notification",
				task_id: "task-bg",
				tool_use_id: "tu-bg",
				status: "completed",
				output_file: "",
				summary: "The other test passes.",
				session_id: "claude-1",
			}),
			wrote(text("u-bg-2", "Nothing new yet.")),
			wrote(done("Nothing new yet.")),
		],
	},
];

/**
 * A chat whose sub-agent text and call name a parent call stored in no row. Conductor takes every
 * sub-agent message out of the main transcript (`vmt`) and has no card to put it in, so it shows
 * none of it. Ours keeps it visible at the top level (D129: nothing hidden), so the check leaves it
 * out of the comparison and counts it.
 */
const ORPHAN_TURNS: { turnId: string; rows: Row[] }[] = [
	{
		turnId: "t-1",
		rows: [
			said("Carry on."),
			wrote(text("u-orphan-1", "Checking the parser.", "tu-gone")),
			wrote(toolUse("tu-orphan", "Read", { file_path: "parse.ts" }, "tu-gone")),
			wrote(toolResult("tu-orphan", "export function parse() {}", "tu-gone")),
			wrote(text("u-own", "All done.")),
			wrote(done("All done.")),
		],
	},
];

/**
 * A database of made-up chats whose transcript is known by hand. Every Claude chat holds the rows
 * above in `session_messages`. Conductor began writing `session_events` partway through real
 * chats, so a chat with `events: "partial"` has events for its last turn only, and they include
 * an injected user payload marked `isSynthetic` that the writer kept out of `session_messages`.
 * A chat with `gap` adds a sent user row with no turn id, which Conductor shows as a placeholder
 * and the mapping cannot map.
 */
function knownCase(
	chats: {
		id: string;
		agent: string;
		events: "partial" | "none";
		gap?: true;
		turns?: typeof TURNS;
	}[],
): {
	dir: string;
	path: string;
} {
	const { dir, path, db } = newDatabase();
	const session = db.prepare(
		"INSERT INTO sessions (id, workspace_id, agent_type) VALUES (?, ?, ?)",
	);
	const event = db.prepare(
		"INSERT INTO session_events (session_id, session_index, event_id, event_type, content, received_at, reverted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
	);
	const message = db.prepare(
		"INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
	);
	for (const chat of chats) {
		session.run(chat.id, "w-1", chat.agent);
		let second = 0;
		let index = 0;
		const at = () =>
			`2026-01-02T03:${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second++ % 60).padStart(2, "0")}.000Z`;
		const turns = chat.turns ?? TURNS;
		for (const turn of turns) {
			const logged = chat.events === "partial" && turn === turns.at(-1);
			for (const row of turn.rows) {
				const sent = at();
				const id = `${chat.id}-m-${index++}`;
				const content = row.role === "user" ? row.text : JSON.stringify(row.payload);
				message.run(id, chat.id, row.role, content, sent, sent, turn.turnId);
				if (!logged) continue;
				const body =
					row.role === "user"
						? { id, text: row.text, state: "sent", turnId: turn.turnId }
						: { type: "agent", turnId: turn.turnId, rawPayload: row.payload };
				event.run(
					chat.id,
					index,
					`${id}-e`,
					row.role === "user" ? "userMessage" : "agent",
					JSON.stringify(body),
					sent,
				);
			}
			if (logged) {
				const injected = {
					type: "user",
					isSynthetic: true,
					session_id: "claude-1",
					parent_tool_use_id: null,
					message: { role: "user", content: [{ type: "text", text: "An injected note." }] },
				};
				event.run(
					chat.id,
					index++,
					`${chat.id}-synthetic`,
					"agent",
					JSON.stringify({ type: "agent", turnId: turn.turnId, rawPayload: injected }),
					at(),
				);
			}
		}
		if (chat.gap) {
			const sent = at();
			message.run(`${chat.id}-m-${index++}`, chat.id, "user", "Lost.", sent, sent, null);
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
 * Every line the spike may print: fixed words, counts, percentages, the row kinds, the reasons,
 * the agent names and the fixed results.
 */
const LINE = new RegExp(
	[
		"^$",
		"^Conductor chat history spike: counts only$",
		"^chats with messages: \\d+$",
		"^chats with events but no messages: \\d+$",
		"^chats sampled: \\d+$",
		"^chats by agent \\(sampled, match, mismatch, not mapped yet\\):$",
		"^  (claude|codex|cursor|acp|other) \\d+ \\d+ \\d+ \\d+$",
		"^chats not mapped yet are left out of the pass mark\\.$",
		"^rows by kind in mapped chats \\(rows, mapped, unmapped\\):$",
		"^  (user|agent|summary|other) \\d+ \\d+ \\d+$",
		"^all rows in mapped chats: \\d+, mapped: \\d+ \\(\\d+\\.\\d%\\)$",
		"^unmapped rows by reason:$",
		"^  (no turn|unreadable|summary|unknown role|untranslated) \\d+$",
		"^mapped rows left out, as Conductor does not show them:$",
		"^  (queued message|turn without a user message|compact command|compacted reply) \\d+$",
		"^rows in chats not mapped yet: \\d+$",
		"^sub-agent entries whose parent call is stored nowhere, shown by D129 and left out of the comparison: \\d+$",
		"^per chat \\(agent; Conductor turns, entries; Conducted turns, entries; result\\):$",
		`^  chat \\d+: (claude|codex|cursor|acp|other) \\d+ \\d+ \\d+ \\d+ (match|not mapped yet|mismatch \\((${MISMATCHES})\\))$`,
		"^mapped chats whose transcript matches: \\d+ of \\d+$",
		"^pass mark \\(at least 99% of rows mapped and every mapped chat matching\\): (met|not met)$",
	].join("|"),
);

describe("APP-18 the chat history spike", () => {
	test("prints counts only, never a value from the database", () => {
		const { path } = fixture();
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		for (const value of SEEDED) expect(out).not.toContain(value);
		for (const line of out.split("\n")) expect(line).toMatch(LINE);
		expect(out).toContain("chats with messages: 3");
		expect(out).toContain("chats with events but no messages: 1");
		expect(out).toContain("chats sampled: 3");
		expect(out).toContain("  user 2 2 0");
		expect(out).toContain("  agent 3 2 1");
		expect(out).toContain("  other 1 0 1");
		expect(out).toContain("  unreadable 1");
		expect(out).toContain("  unknown role 1");
		expect(out).toContain("rows in chats not mapped yet: 2");
		expect(out).toContain("  chat 1: codex 1 2 0 0 not mapped yet");
		expect(out).toContain("  chat 2: claude 1 2 1 2 match");
		expect(out).toContain("  chat 3: claude 1 2 1 2 match");
		expect(out).toContain("  claude 2 2 0 0");
		expect(out).toContain("  codex 1 0 0 1");
	});

	test("checks itself on a known chat: every chat with messages is read from them, a gap shows, Codex is apart", () => {
		const { path } = knownCase([
			{ id: "k-1", agent: "claude", events: "partial" },
			{ id: "k-2", agent: "claude", events: "partial", gap: true },
			{ id: "k-3", agent: "codex", events: "partial" },
			{ id: "k-4", agent: "claude", events: "none" },
		]);
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		for (const line of out.split("\n")) expect(line).toMatch(LINE);
		// Counted by hand, as Conductor's chat shows it (frontend.md 5) and as ours does:
		// turn 1 shows the user's message and the steer, the two main texts and the Read, Task and
		// Edit cards (7); the thinking block, the sub-agent's text and Grep call (inside the Task
		// card), the tool results and the result row add none. Turn 2 is the compaction: Conductor
		// hides `/compact` and the "Compacted" reply, and system rows are not compared (0). Turn 3
		// shows the user's message and one text (2). The injected payload is only in the events.
		expect(out).toContain("chats with messages: 4");
		expect(out).toContain("  chat 1: claude 3 9 3 9 match");
		expect(out).toContain("  chat 2: claude 4 9 3 9 mismatch (turn count)");
		expect(out).toContain("  chat 3: codex 3 9 0 0 not mapped yet");
		expect(out).toContain("  chat 4: claude 3 9 3 9 match");
		// 23 rows a chat (4 user, 19 agent); the gap adds one user row with no turn.
		expect(out).toContain("  user 13 12 1");
		expect(out).toContain("  agent 57 57 0");
		expect(out).toContain("all rows in mapped chats: 70, mapped: 69 (98.6%)");
		expect(out).toContain("  no turn 1");
		expect(out).toContain("  compact command 3");
		expect(out).toContain("  compacted reply 3");
		expect(out).toContain("rows in chats not mapped yet: 23");
		expect(out).toContain("mapped chats whose transcript matches: 2 of 3");
		expect(out).toContain(": not met");
	});

	test("meets the pass mark when every mapped chat reads the same, with a Codex chat left out", () => {
		const { path } = knownCase([
			{ id: "k-1", agent: "claude", events: "partial" },
			{ id: "k-3", agent: "codex", events: "none" },
			{ id: "k-4", agent: "claude", events: "none" },
		]);
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		expect(out).toContain("all rows in mapped chats: 46, mapped: 46 (100.0%)");
		expect(out).toContain("mapped chats whose transcript matches: 2 of 2");
		expect(out).toContain(
			"pass mark (at least 99% of rows mapped and every mapped chat matching): met",
		);
	});

	test("reads a background helper whose late rows sit in a later turn as the same as Conductor (D129)", () => {
		const { path } = knownCase([
			{ id: "k-bg", agent: "claude", events: "none", turns: BACKGROUND_TURNS },
		]);
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		// Conductor's main transcript: turn one's message, Task card and text; turn two's message and text.
		expect(out).toContain("  chat 1: claude 2 5 2 5 match");
		expect(out).toContain("mapped chats whose transcript matches: 1 of 1");
	});

	test("leaves out sub-agent work whose parent call is stored nowhere, and counts it (D129)", () => {
		const { path } = knownCase([
			{ id: "k-orphan", agent: "claude", events: "none", turns: ORPHAN_TURNS },
		]);
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		// Conductor's main transcript: the message and the agent's own text.
		expect(out).toContain("  chat 1: claude 1 2 1 2 match");
		expect(out).toContain(
			"sub-agent entries whose parent call is stored nowhere, shown by D129 and left out of the comparison: 2",
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
