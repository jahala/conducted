import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONDUCTOR_FIXTURE_SCHEMA } from "../../apps/desktop/src/test/conductor-schema.ts";

const SPIKE = join(import.meta.dir, "spike.ts");

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
	const message = db.prepare(
		"INSERT INTO session_messages (id, session_id, role, content, sent_at) VALUES (?, ?, ?, ?, ?)",
	);
	message.run("sm-1", "s-secret-id-8", "user", "secret-user-text-1", "2026-01-02 03:04:05");
	message.run("sm-2", "s-secret-id-8", "assistant", "secret-assistant-text-2", null);
	message.run("sm-3", "s-two", "user", "secret-user-text-1", "2026-01-02 03:04:05");
	message.run("sm-4", "s-two", "assistant", "secret-assistant-text-2", null);
	db.close();
	return { dir, path };
}

function runSpike(args: string[]): { code: number; out: string } {
	const run = Bun.spawnSync(["bun", SPIKE, ...args], { stdout: "pipe", stderr: "pipe" });
	return { code: run.exitCode, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

/** Every line the spike may print: fixed words, counts, percentages and the event type names. */
const LINE = new RegExp(
	[
		"^$",
		"^Conductor chat history spike: counts only$",
		"^chats with events: \\d+$",
		"^chats sampled: \\d+$",
		"^events by type \\(events, mapped, unmapped\\):$",
		"^  (userMessage|agent|checkpointCreated|other) \\d+ \\d+ \\d+$",
		"^all events: \\d+, mapped: \\d+ \\(\\d+\\.\\d%\\)$",
		"^reverted events left out: \\d+$",
		"^per chat \\(Conductor visible, Conducted visible, same order\\):$",
		"^  chat \\d+: \\d+ \\d+ (yes|no)$",
		"^chats whose visible messages match: \\d+ of \\d+$",
		"^pass mark \\(at least 99% mapped and every chat matching\\): (met|not met)$",
	].join("|"),
);

describe("APP-18 the chat history spike", () => {
	test("prints counts only, never a value from the database", () => {
		const { path } = fixture();
		const { code, out } = runSpike([path]);

		expect(code).toBe(0);
		for (const value of SEEDED) expect(out).not.toContain(value);
		for (const line of out.split("\n")) expect(line).toMatch(LINE);
		expect(out).toContain("chats with events: 2");
		expect(out).toContain("chats sampled: 2");
		expect(out).toContain("  userMessage 2 2 0");
		expect(out).toContain("  agent 2 1 1");
		expect(out).toContain("  other 1 0 1");
		expect(out).toContain("reverted events left out: 1");
		expect(out).toContain("  chat 1: 2 2 yes");
		expect(out).toContain("  chat 2: 2 1 no");
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
