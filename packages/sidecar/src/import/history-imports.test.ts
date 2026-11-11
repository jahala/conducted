import { describe, expect, test } from "bun:test";
import type { ConductorPlacedRow, SessionConfig } from "@conducted/protocol";
import { mapConductorMessages } from "./conductor-history.ts";
import { ConductorHistoryImports } from "./history-imports.ts";

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

const say = (text: string) =>
	JSON.stringify({
		type: "assistant",
		uuid: `u-${text}`,
		parent_tool_use_id: null,
		message: { role: "assistant", content: [{ type: "text", text }] },
	});
const RESULT = JSON.stringify({ type: "result", subtype: "success", is_error: false });

const ROWS: ConductorPlacedRow[] = (
	[
		["user", "Hello", "t-1"],
		["assistant", say("Hi"), "t-1"],
		["assistant", RESULT, "t-1"],
		["user", "More", "t-2"],
		["assistant", say("Sure"), "t-2"],
		["assistant", RESULT, "t-2"],
	] as const
).map(([role, content, turn], rowid) => {
	const at = `2026-01-02T03:00:0${rowid}.000Z`;
	return { rowid, id: `m-${rowid}`, role, content, sent_at: at, created_at: at, turn_id: turn };
});
const KEYS = ROWS.map(({ id: _id, content, ...key }) => ({ ...key, chars: content?.length ?? 0 }));

const must = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

describe("APP-18 the chat history import's door into the mapping", () => {
	test("the keys, then reads to the end, give the events mapConductorMessages gives", () => {
		const imports = new ConductorHistoryImports();
		must(
			imports.index({ historyId: "h-1", agent: "claude", config: CONFIG, keys: KEYS.slice(0, 2) }),
		);
		must(imports.index({ historyId: "h-1", agent: "claude", config: CONFIG, keys: KEYS.slice(2) }));
		const events = [];
		let answer = must(imports.map({ historyId: "h-1", rows: [], maxRows: 2, maxChars: 10_000 }));
		while (answer.next !== null) {
			const wanted = new Set(answer.next);
			const rows = ROWS.filter((row) => wanted.has(row.rowid));
			answer = must(imports.map({ historyId: "h-1", rows, maxRows: 2, maxChars: 10_000 }));
			events.push(...answer.events);
		}
		expect(events).toEqual(mapConductorMessages(ROWS, { agent: "claude", config: CONFIG }).events);
		// Done: the mapping closed itself.
		expect(imports.map({ historyId: "h-1", rows: [], maxRows: 2, maxChars: 1 }).ok).toBe(false);
	});

	test("refuses an agent without a mapping, a chat not open, and drops a chat another replaced", () => {
		const imports = new ConductorHistoryImports();
		expect(imports.index({ historyId: "h-1", agent: "codex", config: CONFIG, keys: KEYS }).ok).toBe(
			false,
		);
		expect(imports.map({ historyId: "h-1", rows: [], maxRows: 2, maxChars: 1 }).ok).toBe(false);
		must(imports.index({ historyId: "h-1", agent: "claude", config: CONFIG, keys: KEYS }));
		must(imports.index({ historyId: "h-2", agent: "claude", config: CONFIG, keys: KEYS }));
		expect(imports.map({ historyId: "h-1", rows: [], maxRows: 2, maxChars: 1 }).ok).toBe(false);
		must(imports.close({ historyId: "h-2" }));
		expect(imports.map({ historyId: "h-2", rows: [], maxRows: 2, maxChars: 1 }).ok).toBe(false);
	});

	test("a read that misses a row is refused and drops the chat's mapping", () => {
		const imports = new ConductorHistoryImports();
		must(imports.index({ historyId: "h-1", agent: "claude", config: CONFIG, keys: KEYS }));
		const first = must(imports.map({ historyId: "h-1", rows: [], maxRows: 3, maxChars: 10_000 }));
		expect(first.next).toEqual([0, 1, 2]);
		const missing = imports.map({
			historyId: "h-1",
			rows: ROWS.slice(0, 2),
			maxRows: 3,
			maxChars: 1,
		});
		expect(missing.ok).toBe(false);
		expect(imports.map({ historyId: "h-1", rows: [], maxRows: 3, maxChars: 1 }).ok).toBe(false);
	});
});
