import type { Clock, Result } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryPlatform } from "../../platform/memory.ts";
import type { Database } from "../../platform/platform.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import {
	draftAttachmentsDir,
	draftAttachmentsRoot,
	draftsDir,
	NEW_WORKSPACE_DRAFT_ID,
	terminalHistoryFile,
} from "../app-paths.ts";
import {
	ageCutoff,
	DEFAULT_LIFETIME_LIMITS,
	LIFETIME_LAST_RUN_KEY,
	LIFETIME_STEPS,
	LIFETIME_TOOL_OUTPUT_WATERMARK_KEY,
	type LifetimeLimits,
	MS_PER_DAY,
	runDataLifetimeJob,
} from "./lifetime.ts";

const NOW = 1_800_000_000_000;
const DAY = MS_PER_DAY;

const openStores: ReturnType<typeof openTestDatabase>[] = [];

afterEach(() => {
	for (const store of openStores.splice(0)) store.close();
});

interface Harness {
	store: ReturnType<typeof openTestDatabase>;
	memory: ReturnType<typeof createMemoryPlatform>;
	deps: {
		db: Database;
		fs: ReturnType<typeof createMemoryPlatform>["platform"]["fs"];
		clock: Clock;
		limits: LifetimeLimits;
	};
	setNow(value: number): void;
}

function harness(limits: Partial<LifetimeLimits> = {}): Harness {
	let now = NOW;
	const clock: Clock = { now: () => now };
	const store = openTestDatabase();
	openStores.push(store);
	let next = 0;
	const ids = { uuid: () => `lifetime-id-${++next}` };
	const memory = createMemoryPlatform({ clock, ids, database: store.database });
	return {
		store,
		memory,
		deps: {
			db: store.database,
			fs: memory.platform.fs,
			clock,
			limits: { ...DEFAULT_LIFETIME_LIMITS, ...limits },
		},
		setNow: (value) => {
			now = value;
		},
	};
}

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

async function insertRepo(db: Database, id: string, at: number): Promise<void> {
	await db.execute(
		`INSERT INTO repos (id, name, root_path, default_branch, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		[id, `repo-${id}`, `/code/${id}`, "main", at, at],
	);
}

async function insertWorkspace(
	db: Database,
	input: {
		id: string;
		repoId: string;
		state?: string;
		archivedAt?: number | null;
		createdAt?: number;
		updatedAt?: number;
	},
): Promise<void> {
	const at = input.createdAt ?? NOW - 400 * DAY;
	await db.execute(
		`INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state,
			port, last_activity_at, created_at, updated_at, archived_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		[
			input.id,
			input.repoId,
			`dir-${input.id}`,
			`/code/workspaces/${input.id}`,
			`branch-${input.id}`,
			"origin/main",
			input.state ?? "ready",
			55_000,
			at,
			at,
			input.updatedAt ?? at,
			input.archivedAt ?? null,
		],
	);
}

async function insertSession(
	db: Database,
	id: string,
	workspaceId: string,
	at: number,
): Promise<void> {
	await db.execute(
		`INSERT INTO sessions (id, workspace_id, config, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5)`,
		[id, workspaceId, "{}", at, at],
	);
}

interface EventInput {
	sessionId: string;
	idx: number;
	eventId: string;
	type: "user_message" | "agent" | "turn_ended" | "checkpoint";
	turnId: string;
	content: string;
	receivedAt: number;
}

async function insertEvent(db: Database, event: EventInput): Promise<void> {
	await db.execute(
		`INSERT INTO session_events (session_id, idx, event_id, type, turn_id, content, received_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[
			event.sessionId,
			event.idx,
			event.eventId,
			event.type,
			event.turnId,
			event.content,
			event.receivedAt,
		],
	);
}

const userMessage = (eventId: string, turnId: string, at: number): string =>
	JSON.stringify({
		type: "user_message",
		eventId,
		at,
		messageId: `msg-${eventId}`,
		turnId,
		text: "Fix the login bug",
		attachmentPaths: [],
		delivery: "new_turn",
		config: {},
	});

const agentContent = (eventId: string, turnId: string, at: number, items: unknown[]): string =>
	JSON.stringify({
		type: "agent",
		eventId,
		at,
		turnId,
		message: { agent: "claude", items, raw: { big: true } },
	});

const turnEnded = (eventId: string, turnId: string, at: number): string =>
	JSON.stringify({ type: "turn_ended", eventId, at, turnId, outcome: "success" });

const textItem = (text: string) => ({ kind: "text", text });
const usageItem = () => ({
	kind: "usage",
	inputTokens: 1,
	outputTokens: 2,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});
const toolResult = (output: string) => ({
	kind: "tool_result",
	toolUseId: "tu-1",
	output,
	isError: false,
	truncated: false,
});

const runStep = async (h: Harness, id: string) => {
	const step = LIFETIME_STEPS.find((candidate) => candidate.id === id);
	if (step === undefined) throw new Error(`no lifetime step named ${id}`);
	return step.run(h.deps);
};

const readEvent = async (
	db: Database,
	sessionId: string,
	eventId: string,
): Promise<{ content: string; compacted_at: number | null }> => {
	const rows = await db.select<{ content: string; compacted_at: number | null }>(
		"SELECT content, compacted_at FROM session_events WHERE session_id = $1 AND event_id = $2",
		[sessionId, eventId],
	);
	const row = rows[0];
	if (row === undefined) throw new Error(`event ${eventId} is gone`);
	return row;
};

const count = async (db: Database, table: string): Promise<number> => {
	const rows = await db.select<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`);
	return rows[0]?.total ?? 0;
};

describe("DATA-02 data lifetime", () => {
	it("turns a day count into a time before the given moment", () => {
		expect(ageCutoff(NOW, 30)).toBe(NOW - 30 * DAY);
		expect(ageCutoff(NOW, 0)).toBe(NOW);
	});

	it("cuts an old tool output once and sets compacted_at", async () => {
		const h = harness({ toolOutputMaxAgeDays: 30, toolOutputMaxBytes: 10 });
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		await insertSession(h.deps.db, "s1", "w1", NOW);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "e1",
			type: "agent",
			turnId: "t1",
			content: agentContent("e1", "t1", NOW - 40 * DAY, [
				toolResult("x".repeat(50)),
				textItem("done"),
			]),
			receivedAt: NOW - 40 * DAY,
		});

		const first = must(await runStep(h, "cut-tool-outputs"));
		expect(first.rowsChanged).toBe(1);
		const cut = await readEvent(h.deps.db, "s1", "e1");
		const items = (JSON.parse(cut.content) as { message: { items: Record<string, unknown>[] } })
			.message.items;
		expect(items[0]?.output).toBe("x".repeat(10));
		expect(items[0]?.truncated).toBe(true);
		expect(items[1]?.text).toBe("done");
		expect(cut.compacted_at).toBe(NOW);

		const second = must(await runStep(h, "cut-tool-outputs"));
		expect(second.rowsChanged).toBe(0);
		expect((await readEvent(h.deps.db, "s1", "e1")).content).toBe(cut.content);
	});

	it("skips an event the job already cut, marked by compacted_at", async () => {
		const h = harness({ toolOutputMaxAgeDays: 30, toolOutputMaxBytes: 10 });
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		await insertSession(h.deps.db, "s1", "w1", NOW);
		const content = agentContent("e1", "t1", NOW - 40 * DAY, [
			toolResult("x".repeat(50)),
			textItem("done"),
		]);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "e1",
			type: "agent",
			turnId: "t1",
			content,
			receivedAt: NOW - 40 * DAY,
		});
		// An older run cut this event at an earlier time; the marker is the one home of that fact.
		await h.deps.db.execute(
			"UPDATE session_events SET compacted_at = $1 WHERE session_id = 's1' AND event_id = 'e1'",
			[NOW - 10 * DAY],
		);

		const report = must(await runStep(h, "cut-tool-outputs"));
		expect(report.rowsChanged).toBe(0);
		const kept = await readEvent(h.deps.db, "s1", "e1");
		expect(kept.content).toBe(content);
		expect(kept.compacted_at).toBe(NOW - 10 * DAY);
	});

	it("leaves a tool output that is younger than the age limit alone", async () => {
		const h = harness({ toolOutputMaxAgeDays: 30, toolOutputMaxBytes: 10 });
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		await insertSession(h.deps.db, "s1", "w1", NOW);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "old",
			type: "agent",
			turnId: "t1",
			content: agentContent("old", "t1", NOW - 40 * DAY, [toolResult("x".repeat(50))]),
			receivedAt: NOW - 40 * DAY,
		});
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 1,
			eventId: "new",
			type: "agent",
			turnId: "t2",
			content: agentContent("new", "t2", NOW - DAY, [toolResult("y".repeat(50))]),
			receivedAt: NOW - DAY,
		});

		must(await runStep(h, "cut-tool-outputs"));
		// The old event keeps only its own cut output: nothing of the young event leaks into it.
		const old = JSON.parse((await readEvent(h.deps.db, "s1", "old")).content) as {
			message: { items: unknown[] };
		};
		expect(old.message.items).toEqual([{ ...toolResult("x".repeat(10)), truncated: true }]);
		expect((await readEvent(h.deps.db, "s1", "new")).content).toContain("y".repeat(50));
	});

	it("advances the tool-output watermark so history older than the last run is skipped", async () => {
		const h = harness({ toolOutputMaxAgeDays: 30, toolOutputMaxBytes: 10 });
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		await insertSession(h.deps.db, "s1", "w1", NOW);
		// A short old output is never cut, but the first run must still record how far it looked.
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "short",
			type: "agent",
			turnId: "t1",
			content: agentContent("short", "t1", NOW - 40 * DAY, [toolResult("short")]),
			receivedAt: NOW - 40 * DAY,
		});

		expect(must(await runStep(h, "cut-tool-outputs")).rowsChanged).toBe(0);
		const watermark = await h.deps.db.select<{ value: string }>(
			"SELECT value FROM settings WHERE key = $1",
			[LIFETIME_TOOL_OUTPUT_WATERMARK_KEY],
		);
		expect(JSON.parse(watermark[0]?.value ?? "null")).toBe(NOW - 30 * DAY);

		// Two days later a long output crosses the 30-day line: it is cut.
		h.setNow(NOW + 2 * DAY);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 1,
			eventId: "crossed",
			type: "agent",
			turnId: "t2",
			content: agentContent("crossed", "t2", NOW - 29 * DAY, [toolResult("y".repeat(50))]),
			receivedAt: NOW - 29 * DAY,
		});
		expect(must(await runStep(h, "cut-tool-outputs")).rowsChanged).toBe(1);
		expect((await readEvent(h.deps.db, "s1", "crossed")).compacted_at).toBe(NOW + 2 * DAY);

		// History older than the last run is not scanned again, even a later write at that time.
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 2,
			eventId: "below-watermark",
			type: "agent",
			turnId: "t3",
			content: agentContent("below-watermark", "t3", NOW - 40 * DAY, [toolResult("z".repeat(50))]),
			receivedAt: NOW - 40 * DAY,
		});
		expect(must(await runStep(h, "cut-tool-outputs")).rowsChanged).toBe(0);
		const untouched = await readEvent(h.deps.db, "s1", "below-watermark");
		expect(untouched.compacted_at).toBeNull();
		expect(untouched.content).toContain("z".repeat(50));
	});

	it("removes old and orphaned drafts and keeps a live recent one", async () => {
		const h = harness();
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		// "live" is a chat whose draft is old; "recent" is a chat whose draft is young; "gone" has
		// no chat any more.
		await insertSession(h.deps.db, "live", "w1", NOW);
		await insertSession(h.deps.db, "recent", "w1", NOW);

		const fs = h.deps.fs;
		h.setNow(NOW - 31 * DAY);
		await fs.writeTextAtomic(`${draftsDir(fs.paths)}/live.json`, "{}");
		h.setNow(NOW - DAY);
		await fs.writeTextAtomic(`${draftsDir(fs.paths)}/recent.json`, "{}");
		await fs.writeTextAtomic(`${draftsDir(fs.paths)}/gone.json`, "{}");
		h.setNow(NOW);

		const report = must(await runStep(h, "remove-draft-files"));
		expect(report.filesTrashed).toBe(2);
		expect(await fs.exists(`${draftsDir(fs.paths)}/live.json`)).toBe(false);
		expect(await fs.exists(`${draftsDir(fs.paths)}/recent.json`)).toBe(true);
		expect(await fs.exists(`${draftsDir(fs.paths)}/gone.json`)).toBe(false);
	});

	it("keeps the new-workspace draft while it is young, then removes it when it expires", async () => {
		const h = harness();
		const fs = h.deps.fs;
		h.setNow(NOW - DAY);
		const path = `${draftsDir(fs.paths)}/${NEW_WORKSPACE_DRAFT_ID}.json`;
		await fs.writeTextAtomic(path, "{}");
		h.setNow(NOW);

		const kept = must(await runStep(h, "remove-draft-files"));
		expect(kept.filesTrashed).toBe(0);
		expect(await fs.exists(path)).toBe(true);

		h.setNow(NOW + 31 * DAY);
		const removed = must(await runStep(h, "remove-draft-files"));
		expect(removed.filesTrashed).toBe(1);
		expect(await fs.exists(path)).toBe(false);
	});

	it("removes old draft attachments and sweeps old staging folders", async () => {
		const h = harness();
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		await insertSession(h.deps.db, "s1", "w1", NOW);
		const fs = h.deps.fs;

		h.setNow(NOW - 8 * DAY);
		const oldPath = `${draftAttachmentsDir(fs.paths, "s1")}/old.txt`;
		const orphanPath = `${draftAttachmentsRoot(fs.paths)}/orphan/shot.png`;
		await fs.writeTextAtomic(oldPath, "old");
		await fs.writeTextAtomic(orphanPath, "orphan");
		await h.deps.db.execute(
			`INSERT INTO attachments (id, session_id, kind, original_name, path, is_draft, created_at)
			VALUES ($1, $2, 'text', 'old.txt', $3, 1, $4)`,
			["a-old", "s1", oldPath, NOW - 8 * DAY],
		);

		h.setNow(NOW - DAY);
		const recentPath = `${draftAttachmentsDir(fs.paths, "s1")}/recent.txt`;
		await fs.writeTextAtomic(recentPath, "recent");
		await h.deps.db.execute(
			`INSERT INTO attachments (id, session_id, kind, original_name, path, is_draft, created_at)
			VALUES ($1, $2, 'text', 'recent.txt', $3, 1, $4)`,
			["a-recent", "s1", recentPath, NOW - DAY],
		);
		h.setNow(NOW);

		const report = must(await runStep(h, "remove-draft-attachments"));
		expect(report.rowsChanged).toBe(1);
		expect(report.filesTrashed).toBe(2);
		expect(await fs.exists(oldPath)).toBe(false);
		expect(await fs.exists(orphanPath)).toBe(false);
		expect(await fs.exists(recentPath)).toBe(true);
		expect(await count(h.deps.db, "attachments")).toBe(1);
	});

	it("never trashes a stored path outside the attachment folder, and reports it", async () => {
		const h = harness();
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		await insertSession(h.deps.db, "s1", "w1", NOW);
		const fs = h.deps.fs;

		h.setNow(NOW - 8 * DAY);
		// A file the user dropped from their own folder, and a stored path that climbs out of the
		// staging folder by its spelling. Neither is the app's to trash.
		const userFile = "/code/user-files/report.pdf";
		const climbing = `${draftAttachmentsDir(fs.paths, "s1")}/../../notes.txt`;
		await fs.writeTextAtomic(userFile, "mine");
		await fs.writeTextAtomic(climbing, "also mine");
		for (const [id, path] of [
			["a-user", userFile],
			["a-climbing", climbing],
		]) {
			await h.deps.db.execute(
				`INSERT INTO attachments (id, session_id, kind, original_name, path, is_draft, created_at)
				VALUES ($1, $2, 'text', 'kept.txt', $3, 1, $4)`,
				[id, "s1", path, NOW - 8 * DAY],
			);
		}
		h.setNow(NOW);

		const outcome = await runStep(h, "remove-draft-attachments");

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.error.code).toBe("data_lifetime_path_outside");
		expect(outcome.error.message).toContain(userFile);
		expect(outcome.error.message).toContain(climbing);
		expect(await fs.exists(userFile)).toBe(true);
		expect(await fs.exists(climbing)).toBe(true);
		expect(await count(h.deps.db, "attachments")).toBe(0);
	});

	it("removes ended terminals after the terminal limit with their scrollback", async () => {
		const h = harness();
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		const fs = h.deps.fs;
		for (const [id, endedAt] of [
			["old", NOW - 15 * DAY],
			["recent", NOW - DAY],
			["live", null],
		] as const) {
			await h.deps.db.execute(
				`INSERT INTO terminals (id, workspace_id, kind, title, cwd, started_at, ended_at)
				VALUES ($1, 'w1', 'terminal', $2, '/code', $3, $4)`,
				[id, `terminal-${id}`, NOW - 20 * DAY, endedAt],
			);
			await fs.writeTextAtomic(terminalHistoryFile(fs.paths, id), "scrollback");
		}

		const report = must(await runStep(h, "remove-ended-terminals"));
		expect(report.rowsChanged).toBe(1);
		expect(report.filesTrashed).toBe(1);
		expect(await fs.exists(terminalHistoryFile(fs.paths, "old"))).toBe(false);
		expect(await fs.exists(terminalHistoryFile(fs.paths, "recent"))).toBe(true);
		const ids = (
			await h.deps.db.select<{ id: string }>("SELECT id FROM terminals ORDER BY id")
		).map((row) => row.id);
		expect(ids).toEqual(["live", "recent"]);
	});

	it("deletes history records with their terminal or workspace", async () => {
		const h = harness();
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, { id: "w1", repoId: "r1" });
		await insertWorkspace(h.deps.db, { id: "w2", repoId: "r1" });
		await insertSession(h.deps.db, "s1", "w1", NOW);
		await insertSession(h.deps.db, "s2", "w2", NOW);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "e1",
			type: "user_message",
			turnId: "t1",
			content: userMessage("e1", "t1", NOW),
			receivedAt: NOW,
		});
		await h.deps.db.execute(
			`INSERT INTO session_live_state (session_id, live_state, updated_at)
			VALUES ('s1', '{"status":"idle","pendingSteerIds":[],"backgroundTasks":[],"fastModeAvailable":true}', $1)`,
			[NOW],
		);
		for (const [id, workspaceId] of [
			["term-w1", "w1"],
			["term-w2", "w2"],
		] as const) {
			await h.deps.db.execute(
				`INSERT INTO terminals (id, workspace_id, kind, title, cwd, started_at)
				VALUES ($1, $2, 'terminal', $1, '/code', $3)`,
				[id, workspaceId, NOW],
			);
		}

		await h.deps.db.execute("DELETE FROM terminals WHERE id = 'term-w2'");
		expect(await count(h.deps.db, "terminals")).toBe(1);
		await h.deps.db.execute("DELETE FROM workspaces WHERE id = 'w1'");
		expect(await count(h.deps.db, "sessions")).toBe(1);
		expect(await count(h.deps.db, "session_events")).toBe(0);
		expect(await count(h.deps.db, "session_live_state")).toBe(0);
		expect(await count(h.deps.db, "terminals")).toBe(0);
	});

	it("compacts an archived chat from archived_at, not from a later edit", async () => {
		const h = harness();
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, {
			id: "w1",
			repoId: "r1",
			state: "archived",
			archivedAt: NOW - 100 * DAY,
			updatedAt: NOW,
		});
		await insertSession(h.deps.db, "s1", "w1", NOW);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "u1",
			type: "user_message",
			turnId: "t1",
			content: userMessage("u1", "t1", NOW - 100 * DAY),
			receivedAt: NOW - 100 * DAY,
		});
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 1,
			eventId: "a1",
			type: "agent",
			turnId: "t1",
			content: agentContent("a1", "t1", NOW - 100 * DAY, [
				textItem("early"),
				toolResult("large output"),
			]),
			receivedAt: NOW - 100 * DAY,
		});
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 2,
			eventId: "a2",
			type: "agent",
			turnId: "t1",
			content: agentContent("a2", "t1", NOW - 100 * DAY, [textItem("final answer"), usageItem()]),
			receivedAt: NOW - 100 * DAY,
		});
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 3,
			eventId: "end",
			type: "turn_ended",
			turnId: "t1",
			content: turnEnded("end", "t1", NOW - 100 * DAY),
			receivedAt: NOW - 100 * DAY,
		});

		const report = must(await runStep(h, "compact-archived-chats"));
		expect(report.rowsChanged).toBeGreaterThan(0);
		const ids = (
			await h.deps.db.select<{ event_id: string }>(
				"SELECT event_id FROM session_events WHERE session_id = 's1' ORDER BY idx",
			)
		).map((row) => row.event_id);
		expect(ids).toEqual(["u1", "a2", "end"]);

		const kept = JSON.parse((await readEvent(h.deps.db, "s1", "a2")).content) as {
			message: { items: { kind: string }[]; raw?: unknown };
		};
		expect(kept.message.items.map((item) => item.kind)).toEqual(["text", "usage"]);
		expect(kept.message.raw).toBeUndefined();
		const ended = (
			await h.deps.db.select<{ compacted_at: number | null }>(
				"SELECT compacted_at FROM session_events WHERE session_id = 's1' AND event_id = 'end'",
			)
		)[0];
		expect(ended?.compacted_at).toBe(NOW);

		const again = must(await runStep(h, "compact-archived-chats"));
		expect(again.rowsChanged).toBe(0);
	});

	it("leaves a chat alone when the workspace was archived less than the limit ago", async () => {
		const h = harness();
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, {
			id: "w1",
			repoId: "r1",
			state: "archived",
			archivedAt: NOW - 10 * DAY,
			updatedAt: NOW - 100 * DAY,
		});
		await insertSession(h.deps.db, "s1", "w1", NOW);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "a1",
			type: "agent",
			turnId: "t1",
			content: agentContent("a1", "t1", NOW - 100 * DAY, [
				textItem("still here"),
				toolResult("still here"),
			]),
			receivedAt: NOW - 100 * DAY,
		});
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 1,
			eventId: "end",
			type: "turn_ended",
			turnId: "t1",
			content: turnEnded("end", "t1", NOW - 100 * DAY),
			receivedAt: NOW - 100 * DAY,
		});

		const report = must(await runStep(h, "compact-archived-chats"));
		expect(report.rowsChanged).toBe(0);
		expect(await count(h.deps.db, "session_events")).toBe(2);
	});

	it("keeps workspaces and the chats and events of a live workspace", async () => {
		const h = harness();
		await insertRepo(h.deps.db, "r1", NOW - 400 * DAY);
		await insertWorkspace(h.deps.db, {
			id: "w1",
			repoId: "r1",
			state: "ready",
			createdAt: NOW - 400 * DAY,
			updatedAt: NOW - 400 * DAY,
		});
		await insertSession(h.deps.db, "s1", "w1", NOW - 400 * DAY);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "u1",
			type: "user_message",
			turnId: "t1",
			content: userMessage("u1", "t1", NOW - 400 * DAY),
			receivedAt: NOW - 400 * DAY,
		});

		const report = must(await runDataLifetimeJob(h.deps));
		expect(report.kind).toBe("ran");
		expect(await count(h.deps.db, "workspaces")).toBe(1);
		expect(await count(h.deps.db, "sessions")).toBe(1);
		expect(await count(h.deps.db, "session_events")).toBe(1);
	});

	it("skips a second run within a day and runs again after it", async () => {
		const h = harness();
		const first = must(await runDataLifetimeJob(h.deps));
		expect(first.kind).toBe("ran");

		h.setNow(NOW - 31 * DAY);
		await h.deps.fs.writeTextAtomic(`${draftsDir(h.deps.fs.paths)}/old.json`, "{}");
		h.setNow(NOW);

		const second = must(await runDataLifetimeJob(h.deps));
		expect(second).toEqual({ kind: "skipped", lastRunAt: NOW });
		expect(await h.deps.fs.exists(`${draftsDir(h.deps.fs.paths)}/old.json`)).toBe(true);

		h.setNow(NOW + DAY);
		const third = must(await runDataLifetimeJob(h.deps));
		expect(third.kind).toBe("ran");
		expect(await h.deps.fs.exists(`${draftsDir(h.deps.fs.paths)}/old.json`)).toBe(false);
		const stored = await h.deps.db.select<{ value: string }>(
			"SELECT value FROM settings WHERE key = $1",
			[LIFETIME_LAST_RUN_KEY],
		);
		expect(JSON.parse(stored[0]?.value ?? "null")).toBe(NOW + DAY);
	});

	it("runs every step even when one fails and still records the run", async () => {
		const h = harness({ toolOutputMaxBytes: 10 });
		await insertRepo(h.deps.db, "r1", NOW);
		await insertWorkspace(h.deps.db, {
			id: "w1",
			repoId: "r1",
			state: "archived",
			archivedAt: NOW - 100 * DAY,
		});
		await insertSession(h.deps.db, "s1", "w1", NOW);
		await insertEvent(h.deps.db, {
			sessionId: "s1",
			idx: 0,
			eventId: "broken",
			type: "agent",
			turnId: "t1",
			content: "not json but long enough to be a tool output candidate",
			receivedAt: NOW - 100 * DAY,
		});
		h.setNow(NOW - 31 * DAY);
		const draftPath = `${draftsDir(h.deps.fs.paths)}/orphan.json`;
		await h.deps.fs.writeTextAtomic(draftPath, "{}");
		h.setNow(NOW);

		const report = must(await runDataLifetimeJob(h.deps));
		expect(report.kind).toBe("ran");
		if (report.kind !== "ran") throw new Error("unreachable");
		expect(report.steps).toHaveLength(LIFETIME_STEPS.length);
		const cut = report.steps.find((step) => step.id === "cut-tool-outputs");
		expect(cut?.outcome.ok).toBe(false);
		expect(report.steps[0]?.outcome.ok).toBe(true);
		expect(report.steps.at(-1)?.outcome.ok).toBe(true);
		expect(await h.deps.fs.exists(draftPath)).toBe(false);

		const second = must(await runDataLifetimeJob(h.deps));
		expect(second).toEqual({ kind: "skipped", lastRunAt: NOW });
	});
});
