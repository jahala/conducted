/**
 * @feature DATA-02 Data-lifetime job and DATA-01 event repository
 *
 * Measures the database scans the audit named (#392): the startup repair query that finds
 * interrupted turns, the daily lifetime job's two session_events scans and the smaller filters on
 * attachments, terminals, workspaces, section_members, backlog_workspaces and
 * workspaces.active_session_id.
 *
 * It builds a file database through the app's real migrations, with the same pragmas the app and
 * the test database use, in a folder this run creates and deletes at the end, even on failure.
 *
 * The volume and why, so a later run can be compared with this one:
 * - 20 repositories, 500 workspaces, 5,000 chats, 2,000,000 events. Conductor's database reached
 *   12 GB (D006); 500 workspaces and 5,000 chats is a heavy but real user's library, and 400
 *   events per chat covers months of tool-heavy agent work.
 * - Events spread over 400 days, so about 92% are older than the 30-day tool-output limit and the
 *   daily scan really does meet the whole history.
 * - Event mix: 25% user_message, 25% turn_ended, 50% agent. An agent event is half text and half a
 *   tool result. Tool outputs are 92% small (100 to 1,500 characters), 7% medium (5,000 to 40,000)
 *   and 1% large (120,000 to 300,000), close to what a shell or file read returns. That puts about
 *   10,000 events past the 100,000-character cut and yields a database of a few gigabytes.
 * - 30,000 attachments, 10,000 terminals, 20 sections, 500 section members and 300 backlog rows,
 *   with archived workspaces among the 500 so the compact query has work.
 *
 * The instrument is checked first: a lookup on the primary key must use an index and be fast, and
 * a filter on an unindexed column must scan. The script exits 1 when either check is wrong.
 *
 * Run: bun scripts/with-run-dir.ts bun scripts/measure/db-scans.ts
 * The output is also written to docs/research/db-scans-2026-11-07.md by hand.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ATTACHMENTS_SQL } from "../../apps/desktop/src/core/db/attachments.ts";
import { ageCutoff, LIFETIME_SQL, MS_PER_DAY } from "../../apps/desktop/src/core/db/lifetime.ts";
import { SECTIONS_SQL } from "../../apps/desktop/src/core/db/sections.ts";
import { SESSION_EVENTS_SQL } from "../../apps/desktop/src/core/db/session-events.ts";
import { WORKSPACES_SQL } from "../../apps/desktop/src/core/db/workspaces.ts";
import { DATABASE_PRAGMAS } from "../../apps/desktop/src/platform/queued-database.ts";

const NOW = Date.UTC(2026, 10, 7);
const REPOS = 20;
const WORKSPACES = 500;
const SESSIONS = 5_000;
const EVENTS = 2_000_000;
const EVENTS_PER_SESSION = EVENTS / SESSIONS;

/** A deterministic generator, so the before and after runs see the same rows. */
function rng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const random = rng(39_239_239);
const between = (low: number, high: number): number =>
	low + Math.floor(random() * (high - low + 1));
const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../apps/desktop/src-tauri/migrations");
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
	.filter((name) => name.endsWith(".sql"))
	.sort()
	.map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"));

function openDatabase(path: string): Database {
	const db = new Database(path, { create: true });
	for (const pragma of DATABASE_PRAGMAS) db.exec(pragma);
	for (const sql of MIGRATIONS) db.exec(sql);
	return db;
}

const configObject = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};
const config = JSON.stringify(configObject);

function toolOutput(): string {
	const roll = random();
	const size =
		roll < 0.92
			? between(100, 1_500)
			: roll < 0.99
				? between(5_000, 40_000)
				: between(120_000, 300_000);
	const line = "line of terminal output from a build or a file read";
	const body = `${line}\n`.repeat(Math.ceil(size / line.length));
	return body.slice(0, size);
}

interface SeededEvent {
	type: "user_message" | "agent" | "turn_ended";
	content: string;
	at: number;
	revertedAt: number | null;
}

function eventAt(sessionStart: number, turn: number, step: number): number {
	return sessionStart + turn * 120_000 + step * 1_000 + between(0, 900);
}

function seedEvents(
	db: Database,
	sessions: { id: string; workspaceId: string; startedAt: number }[],
): void {
	const insert = db.prepare(
		`INSERT INTO session_events
			(session_id, idx, event_id, type, turn_id, content, received_at, reverted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	// Repair needs a few turns with no turn_ended, and revert needs a few reverted rows.
	const interrupted = new Set(sessions.slice(0, 50).map((session) => session.id));
	const reverted = new Set(sessions.slice(50, 55).map((session) => session.id));
	db.exec("BEGIN");
	for (const [sessionIndex, session] of sessions.entries()) {
		let idx = 0;
		const turns = EVENTS_PER_SESSION / 4;
		for (let turn = 0; turn < turns; turn++) {
			const turnId = `turn-${sessionIndex}-${turn}`;
			const userAt = eventAt(session.startedAt, turn, 0);
			const textAt = eventAt(session.startedAt, turn, 1);
			const toolAt = eventAt(session.startedAt, turn, 2);
			const endAt = eventAt(session.startedAt, turn, 3);
			const revertAt = reverted.has(session.id) && turn === turns - 1 ? endAt + 1_000 : null;
			const add = (
				type: SeededEvent["type"],
				content: string,
				at: number,
				revert: number | null,
			): void => {
				insert.run(session.id, idx, `ev-${session.id}-${idx}`, type, turnId, content, at, revert);
				idx += 1;
			};
			add(
				"user_message",
				JSON.stringify({
					type: "user_message",
					eventId: `ev-${session.id}-${idx}`,
					at: userAt,
					messageId: `msg-${session.id}-${turn}`,
					turnId,
					text: pick([
						"Fix the login bug and run the tests",
						"Add a test for the empty list",
						"Refactor this module without changing behaviour",
						"Open a pull request when the checks pass",
					]),
					attachmentPaths: [],
					delivery: "new_turn",
					config: configObject,
				}),
				userAt,
				revertAt,
			);
			add(
				"agent",
				JSON.stringify({
					type: "agent",
					eventId: `ev-${session.id}-${idx}`,
					at: textAt,
					turnId,
					message: {
						agent: "claude",
						items: [
							{
								kind: "text",
								text: pick([
									"Looking at the code now.",
									"I will run the tests.",
									"The change is ready.",
								]),
							},
						],
						raw: { id: `raw-${session.id}-${turn}` },
					},
				}),
				textAt,
				revertAt,
			);
			add(
				"agent",
				JSON.stringify({
					type: "agent",
					eventId: `ev-${session.id}-${idx}`,
					at: toolAt,
					turnId,
					message: {
						agent: "claude",
						items: [
							{
								kind: "tool_call",
								toolUseId: `tu-${turn}`,
								tool: "bash",
								rawName: "Bash",
								input: { command: "bun test" },
							},
							{
								kind: "tool_result",
								toolUseId: `tu-${turn}`,
								output: toolOutput(),
								isError: false,
								truncated: false,
							},
						],
						raw: { id: `raw-${session.id}-${turn}` },
					},
				}),
				toolAt,
				revertAt,
			);
			if (interrupted.has(session.id) && turn === turns - 1) {
				// The crash left this turn with no turn_ended event. Keep the event count by writing
				// one more agent event in its place.
				add(
					"agent",
					JSON.stringify({
						type: "agent",
						eventId: `ev-${session.id}-${idx}`,
						at: endAt,
						turnId,
						message: { agent: "claude", items: [{ kind: "text", text: "Still working." }] },
					}),
					endAt,
					revertAt,
				);
			} else {
				add(
					"turn_ended",
					JSON.stringify({
						type: "turn_ended",
						eventId: `ev-${session.id}-${idx}`,
						at: endAt,
						turnId,
						outcome: "success",
					}),
					endAt,
					revertAt,
				);
			}
		}
		if (sessionIndex % 250 === 0) console.log(`  events: ${idx * (sessionIndex + 1)} / ${EVENTS}`);
	}
	db.exec("COMMIT");
}

function seed(db: Database): void {
	const insertRepo = db.prepare(
		`INSERT INTO repos (id, name, root_path, default_branch, created_at, updated_at)
		VALUES (?, ?, ?, 'main', ?, ?)`,
	);
	const insertWorkspace = db.prepare(
		`INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state,
			port, last_activity_at, created_at, updated_at, archived_at, host_kind)
		VALUES (?, ?, ?, ?, ?, 'origin/main', ?, ?, ?, ?, ?, ?, 'local')`,
	);
	const insertSession = db.prepare(
		`INSERT INTO sessions (id, workspace_id, config, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)`,
	);
	const insertAttachment = db.prepare(
		`INSERT INTO attachments (id, session_id, message_id, kind, original_name, path, is_draft, created_at)
		VALUES (?, ?, ?, 'file', ?, ?, ?, ?)`,
	);
	const insertTerminal = db.prepare(
		`INSERT INTO terminals (id, workspace_id, kind, title, cwd, cols, rows, started_at, ended_at, exit_code)
		VALUES (?, ?, 'run', 'dev server', ?, 120, 30, ?, ?, ?)`,
	);
	const insertSection = db.prepare(
		"INSERT INTO sections (id, name, position, created_at) VALUES (?, ?, ?, ?)",
	);
	const insertMember = db.prepare(
		"INSERT INTO section_members (section_id, workspace_id, position) VALUES (?, ?, ?)",
	);
	const insertBacklog = db.prepare(
		`INSERT INTO backlog_workspaces (id, repo_id, prompt, config, section_id, created_at, updated_at)
		VALUES (?, ?, 'Do the thing', ?, ?, ?, ?)`,
	);

	const repoIds: string[] = [];
	const workspaceIds: string[] = [];
	const sessions: { id: string; workspaceId: string; startedAt: number }[] = [];
	db.exec("BEGIN");
	for (let i = 0; i < REPOS; i++) {
		const id = `repo-${i}`;
		repoIds.push(id);
		insertRepo.run(id, `project-${i}`, `/code/project-${i}`, NOW - 500 * MS_PER_DAY, NOW);
	}
	for (let i = 0; i < WORKSPACES; i++) {
		const id = `ws-${i}`;
		const archived = i % 25 === 0;
		workspaceIds.push(id);
		insertWorkspace.run(
			id,
			pick(repoIds),
			`place-${i}`,
			`/code/workspaces/place-${i}`,
			`user/place-${i}`,
			archived ? "archived" : "ready",
			55_100 + i,
			NOW - between(0, 400) * MS_PER_DAY,
			NOW - 400 * MS_PER_DAY,
			NOW,
			archived ? NOW - between(100, 300) * MS_PER_DAY : null,
		);
	}
	for (let i = 0; i < SESSIONS; i++) {
		const id = `chat-${i}`;
		const workspaceId = workspaceIds[i % WORKSPACES] as string;
		const startedAt = NOW - between(0, 400) * MS_PER_DAY;
		sessions.push({ id, workspaceId, startedAt });
		insertSession.run(id, workspaceId, config, startedAt, startedAt);
	}
	db.exec("COMMIT");

	// A chat tab is open on every workspace.
	db.exec(
		`UPDATE workspaces SET active_session_id = (
			SELECT id FROM sessions WHERE sessions.workspace_id = workspaces.id LIMIT 1)`,
	);

	console.log("  seeding events");
	seedEvents(db, sessions);

	db.exec("BEGIN");
	for (let i = 0; i < 30_000; i++) {
		const session = sessions[i % SESSIONS] as { id: string };
		const draft = i % 5 === 0;
		insertAttachment.run(
			`att-${i}`,
			session.id,
			draft ? null : `msg-${session.id}-${i % 100}`,
			`file-${i}.txt`,
			`/data/draft-attachments/${session.id}/file-${i}.txt`,
			draft ? 1 : 0,
			NOW - between(0, 60) * MS_PER_DAY,
		);
	}
	for (let i = 0; i < 10_000; i++) {
		const startedAt = NOW - between(0, 60) * MS_PER_DAY;
		const ended = i % 2 === 0;
		insertTerminal.run(
			`term-${i}`,
			workspaceIds[i % WORKSPACES] as string,
			`/code/workspaces/place-${i % WORKSPACES}`,
			startedAt,
			ended ? startedAt + 60_000 : null,
			ended ? 0 : null,
		);
	}
	for (let i = 0; i < 20; i++) insertSection.run(`sec-${i}`, `Section ${i}`, i, NOW);
	for (let i = 0; i < WORKSPACES; i++) {
		insertMember.run(`sec-${i % 20}`, workspaceIds[i] as string, i);
	}
	for (let i = 0; i < 300; i++) {
		insertBacklog.run(
			`backlog-${i}`,
			pick(repoIds),
			config,
			i % 3 === 0 ? `sec-${i % 20}` : null,
			NOW,
			NOW,
		);
	}
	db.exec("COMMIT");
}

interface Measurement {
	name: string;
	sql: string;
	params: readonly (string | number | null)[];
	kind: "select" | "write";
}

const sessionOne = "chat-7";
const workspaceOne = "ws-7";
const messageOne = "msg-chat-13-4";
const now = NOW;
const cutoff30 = ageCutoff(now, 30);
const cutoff7 = ageCutoff(now, 7);
const cutoff14 = ageCutoff(now, 14);
const cutoff90 = ageCutoff(now, 90);

const MEASUREMENTS: Measurement[] = [
	{
		name: "repair findInterruptedTurns (all chats)",
		sql: SESSION_EVENTS_SQL.findInterruptedTurns,
		params: [],
		kind: "select",
	},
	{
		name: "repair findInterruptedTurns (one chat)",
		sql: SESSION_EVENTS_SQL.findInterruptedTurnsForSession,
		params: [sessionOne],
		kind: "select",
	},
	{
		name: "lifetime cutToolOutputs (one batch)",
		sql: LIFETIME_SQL.cutToolOutputs,
		params: [100_000, now, cutoff30, 200],
		kind: "write",
	},
	{
		name: "lifetime findCompactableTurns",
		sql: LIFETIME_SQL.findCompactableTurns,
		params: [cutoff90, 200],
		kind: "select",
	},
	{
		name: "attachments by message_id",
		sql: ATTACHMENTS_SQL.listByMessage,
		params: [messageOne],
		kind: "select",
	},
	{
		name: "attachments restoreToDraft by message_id",
		sql: ATTACHMENTS_SQL.restoreToDraft,
		params: [messageOne],
		kind: "write",
	},
	{
		name: "lifetime listExpiredDraftAttachments (is_draft, created_at)",
		sql: LIFETIME_SQL.listExpiredDraftAttachments,
		params: [cutoff7, 200],
		kind: "select",
	},
	{
		name: "lifetime listEndedTerminals (ended_at)",
		sql: LIFETIME_SQL.listEndedTerminals,
		params: [cutoff14, 200],
		kind: "select",
	},
	{
		name: "workspaces.listByState (state alone)",
		sql: WORKSPACES_SQL.listByState,
		params: ["ready"],
		kind: "select",
	},
	{
		name: "sections.removeFromAllSections (workspace_id)",
		sql: SECTIONS_SQL.removeFromAllSections,
		params: [workspaceOne],
		kind: "write",
	},
	{
		name: "backlog_workspaces by section_id (no production query)",
		sql: "SELECT id FROM backlog_workspaces WHERE section_id = ? ORDER BY created_at, id",
		params: ["sec-7"],
		kind: "select",
	},
	{
		name: "sessions.delete (workspaces.active_session_id)",
		sql: "DELETE FROM sessions WHERE id = ?",
		params: [sessionOne],
		kind: "write",
	},
];

/**
 * The cost an event append pays for every index on session_events. It inserts 1,000 events in one
 * transaction and rolls it back, so the database keeps the same rows for the other measurements.
 */
function measureEventInserts(db: Database): number {
	const append = db.prepare(SESSION_EVENTS_SQL.append);
	const content = JSON.stringify({
		type: "agent",
		eventId: "ev-inserted",
		at: now,
		turnId: "turn-inserted",
		message: { agent: "claude", items: [{ kind: "text", text: "A new event." }] },
	});
	const started = performance.now();
	db.exec("BEGIN");
	for (let i = 0; i < 1_000; i++) {
		append.run(sessionOne, `ev-inserted-${i}`, "agent", "turn-inserted", content, now);
	}
	db.exec("ROLLBACK");
	return performance.now() - started;
}

function plan(db: Database, sql: string, params: readonly (string | number | null)[]): string {
	const rows = db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
	return rows.map((row) => row.detail).join(" | ");
}

function time(db: Database, measurement: Measurement): number {
	const started = performance.now();
	if (measurement.kind === "select") db.query(measurement.sql).all(...measurement.params);
	else {
		// Run the write once and roll it back, so every measurement sees the same rows.
		db.exec("BEGIN");
		db.query(measurement.sql).run(...measurement.params);
		db.exec("ROLLBACK");
	}
	return performance.now() - started;
}

function checkInstrument(db: Database): void {
	const indexedSql = "SELECT COUNT(*) AS n FROM session_events WHERE session_id = ?";
	const plainSql = "SELECT COUNT(*) AS n FROM session_events WHERE length(content) = 99999";
	const indexed = plan(db, indexedSql, [sessionOne]);
	const plain = plan(db, plainSql, []);
	const indexedMs = (() => {
		const started = performance.now();
		db.query(indexedSql).get(sessionOne);
		return performance.now() - started;
	})();
	const plainMs = (() => {
		const started = performance.now();
		db.query(plainSql).get();
		return performance.now() - started;
	})();
	console.log("=== instrument check ===");
	console.log(`indexed lookup: ${indexed}  (${indexedMs.toFixed(2)} ms)`);
	console.log(`unindexed scan: ${plain}  (${plainMs.toFixed(2)} ms)`);
	if (!/USING (COVERING )?INDEX/.test(indexed)) {
		throw new Error("The instrument is wrong: the primary-key lookup did not use an index.");
	}
	if (!plain.startsWith("SCAN session_events")) {
		throw new Error("The instrument is wrong: the unindexed filter did not scan the table.");
	}
	if (indexedMs > plainMs) {
		throw new Error("The instrument is wrong: the indexed lookup was slower than the scan.");
	}
}

/**
 * Deletes the folder this run made. It holds only the scratch database (several GB), so moving it to
 * the Trash would fill the disk run after run; a run may delete a temp folder it created itself.
 */
function removeRunFolder(path: string): void {
	rmSync(path, { recursive: true, force: true });
}

function main(): void {
	const folder = mkdtempSync(join(tmpdir(), "conducted-db-scans-"));
	const path = join(folder, "conducted.db");
	console.log(`Database: ${path}`);
	const db = openDatabase(path);
	try {
		console.log("Seeding the real-size database");
		seed(db);
		const size = db.query("PRAGMA page_count").get() as { page_count: number };
		const page = db.query("PRAGMA page_size").get() as { page_size: number };
		const indexes = db
			.query(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all() as { name: string }[];
		console.log(
			`Size: ${((size.page_count * page.page_size) / 1_000_000_000).toFixed(2)} GB; indexes: ${
				indexes.map((row) => row.name).join(", ") || "none"
			}`,
		);

		checkInstrument(db);

		console.log("\n=== measurements ===");
		for (const measurement of MEASUREMENTS) {
			const queryPlan = plan(db, measurement.sql, measurement.params);
			const ms = time(db, measurement);
			console.log(`${measurement.name}\n  ${queryPlan}\n  ${ms.toFixed(2)} ms\n`);
		}

		const insertMs = measureEventInserts(db);
		console.log(
			`event append, 1,000 events\n  ${insertMs.toFixed(2)} ms (${(insertMs / 1_000).toFixed(3)} ms per event)\n`,
		);
	} finally {
		db.close();
		removeRunFolder(folder);
	}
}

main();
