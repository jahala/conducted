// @vitest-environment node
import type { DatabaseSync } from "node:sqlite";
import { idleLiveState, type SessionEvent } from "@conducted/protocol";
import type { MessageId, SessionId, WorkspaceId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database, FileSystem } from "../../platform/platform.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { QUEUED_MESSAGES_SQL, queuedMessageToParams } from "./queued-messages.ts";
import { idleLiveStateJson, REPAIR_SQL, runStartupRepair } from "./repair.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { SESSION_EVENTS_SQL, sessionEventToParams } from "./session-events.ts";
import { liveStateToParams, SESSION_LIVE_STATE_SQL } from "./session-live-state.ts";
import { SESSIONS_SQL, sessionToParams } from "./sessions.ts";
import { TERMINALS_SQL, terminalToParams } from "./terminals.ts";
import {
	agentEvent,
	sampleQueued,
	sampleRepo,
	sampleSession,
	sampleTerminal,
	sampleWorkspace,
	sessionId,
	turnEndedEvent,
	userMessageEvent,
} from "./test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "./workspaces.ts";

/** node:sqlite binds `$1..$n` by name, so a positional list becomes `{ $1: ... }`. */
const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** Delegates to a real database, but fails when the archiving list is read. */
class FailingOnArchivingDatabase implements Database {
	readonly #inner: Database;
	readonly #wrapped: Database;

	constructor(inner: Database) {
		this.#inner = inner;
		this.#wrapped = {
			execute: (sql, params) => this.execute(sql, params),
			select: <Row>(sql: string, params?: readonly unknown[]) => this.select<Row>(sql, params),
			transaction: <T>(work: (db: Database) => Promise<T>) => this.transaction(work),
		};
	}

	async execute(sql: string, params: readonly unknown[] = []) {
		return this.#inner.execute(sql, params);
	}

	async select<Row>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
		if (sql === REPAIR_SQL.listArchivingWorkspaces) throw new Error("disk on fire");
		return this.#inner.select<Row>(sql, params);
	}

	async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
		return this.#inner.transaction(() => work(this.#wrapped));
	}
}

let store: ReturnType<typeof openTestDatabase>;
let raw: DatabaseSync;
let database: Database;
let now: number;
let nextId: number;
let existingPaths: Set<string>;

const deps = () => ({
	db: database,
	fs: { exists: async (path: string) => existingPaths.has(path) } as FileSystem,
	clock: { now: () => now },
	ids: { uuid: () => `generated-${++nextId}` },
});

const run = (sql: string, params: readonly unknown[] = []): number =>
	Number(raw.prepare(sql).run(bind(params)).changes);

const rows = <Row>(sql: string, params: readonly unknown[] = []): Row[] =>
	raw.prepare(sql).all(bind(params)) as Row[];

const append = (event: SessionEvent): void => {
	rows(SESSION_EVENTS_SQL.append, must(sessionEventToParams(sessionId, event, event.at)));
};

const insertWorkspace = (id: string, state: string, setupLogPath: string | null): void => {
	run(
		WORKSPACES_SQL.insert,
		must(
			workspaceToParams({
				...sampleWorkspace,
				id: id as WorkspaceId,
				directoryName: id,
				path: `/code/workspaces/${id}`,
				state: state as never,
				setupLogPath,
			}),
		),
	);
};

const insertQueued = (id: string, state: "sending" | "failed"): void => {
	run(
		QUEUED_MESSAGES_SQL.insert,
		must(
			queuedMessageToParams(
				{ ...sampleQueued, id: id as MessageId, state, lastError: null, delivery: "queue" },
				1,
			),
		),
	);
};

/** A database left behind by a crash: a live turn, half-sent queue, half-built workspaces. */
const seedCrash = (): void => {
	run(REPOS_SQL.insert, repoToParams(sampleRepo));
	insertWorkspace(sampleWorkspace.id, "ready", null);
	insertWorkspace("init", "initializing", "/data/setup-logs/init.log");
	insertWorkspace("already-failed", "failed", "/data/setup-logs/already-failed.log");
	insertWorkspace("archiving", "archiving", null);
	insertWorkspace("archiving-gone", "archiving", null);

	run(SESSIONS_SQL.insert, must(sessionToParams(sampleSession)));
	run(
		SESSIONS_SQL.insert,
		must(sessionToParams({ ...sampleSession, id: "chat-2" as SessionId, title: "Second" })),
	);

	run(
		SESSION_LIVE_STATE_SQL.upsert,
		must(liveStateToParams(sessionId, { ...idleLiveState, status: "working" }, 5)),
	);

	append(userMessageEvent("e1", "t1", 10));
	append(agentEvent("e2", "t1", 11, [{ kind: "text", text: "partial" }]));
	append(userMessageEvent("e3", "t2", 12));
	append(turnEndedEvent("e4", "t2", 13));

	insertQueued("msg-e1", "sending");
	insertQueued("b", "sending");
	insertQueued("c", "failed");

	run(TERMINALS_SQL.insert, terminalToParams(sampleTerminal));
};

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	database = store.database;
	now = 9000;
	nextId = 0;
	existingPaths = new Set(["/code/workspaces/archiving"]);
});

afterEach(() => {
	store.close();
});

describe("DATA-03 startup repair closes turns cut off by a crash", () => {
	it("gives an interrupted turn_ended event with a new id and the current time", async () => {
		seedCrash();

		const report = must(await runStartupRepair(deps()));
		expect(report.interruptedTurns).toEqual([{ sessionId, turnId: "t1" }]);

		const events = rows<{ type: string; content: string }>(SESSION_EVENTS_SQL.listFrom, [
			sessionId,
			0,
			10,
		]);
		expect(events.map((row) => row.type)).toEqual([
			"user_message",
			"agent",
			"user_message",
			"turn_ended",
			"turn_ended",
		]);
		expect(JSON.parse(events[4]?.content ?? "{}")).toMatchObject({
			type: "turn_ended",
			eventId: "generated-1",
			at: 9000,
			turnId: "t1",
			outcome: "interrupted",
		});
	});

	it("leaves a turn that already ended alone and adds nothing on a second run", async () => {
		seedCrash();
		must(await runStartupRepair(deps()));

		const second = must(await runStartupRepair(deps()));
		expect(second.interruptedTurns).toEqual([]);
		const ended = rows<{ total: number }>(
			"SELECT COUNT(*) AS total FROM session_events WHERE type = 'turn_ended'",
		);
		expect(ended[0]?.total).toBe(2);
	});
});

describe("DATA-03 startup repair survives the sidecar replaying a closed turn", () => {
	it("keeps the single interrupted end when the rest of the turn is replayed", async () => {
		seedCrash();
		const report = must(await runStartupRepair(deps()));
		expect(report.interruptedTurns).toEqual([{ sessionId, turnId: "t1" }]);

		// The write-ahead log still held the rest of t1. Ingest keeps the late agent output and
		// drops the real turn_ended, because the turn already has one (DATA-04).
		append(agentEvent("e5", "t1", 14, [{ kind: "text", text: "late output" }]));

		const events = rows<{ type: string }>(SESSION_EVENTS_SQL.listByTurn, [sessionId, "t1"]);
		expect(events.map((row) => row.type)).toEqual(["user_message", "agent", "turn_ended", "agent"]);
		expect(events.filter((row) => row.type === "turn_ended")).toHaveLength(1);

		const open = rows<{ session_id: string; turn_id: string }>(REPAIR_SQL.findInterruptedTurns);
		expect(open).toEqual([]);

		const second = must(await runStartupRepair(deps()));
		expect(second.interruptedTurns).toEqual([]);
	});
});

describe("DATA-03 startup repair resets stale working state", () => {
	it("resets a working chat to idle and leaves an idle chat alone", async () => {
		seedCrash();
		run(
			SESSION_LIVE_STATE_SQL.upsert,
			must(liveStateToParams("chat-2" as SessionId, idleLiveState, 6)),
		);

		const report = must(await runStartupRepair(deps()));
		expect(report.liveStatesReset).toBe(1);

		const live = rows<{ session_id: string; live_state: string; updated_at: number }>(
			SESSION_LIVE_STATE_SQL.listAll,
		);
		expect(live).toEqual([
			{ session_id: "chat-1", live_state: idleLiveStateJson(), updated_at: 9000 },
			{ session_id: "chat-2", live_state: idleLiveStateJson(), updated_at: 6 },
		]);

		const second = must(await runStartupRepair(deps()));
		expect(second.liveStatesReset).toBe(0);
	});

	it("clears an open question and background tasks that an idle row kept from before the crash", async () => {
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		insertWorkspace(sampleWorkspace.id, "ready", null);
		run(SESSIONS_SQL.insert, must(sessionToParams(sampleSession)));
		run(
			SESSIONS_SQL.insert,
			must(sessionToParams({ ...sampleSession, id: "chat-2" as SessionId, title: "Second" })),
		);
		run(
			SESSION_LIVE_STATE_SQL.upsert,
			must(
				liveStateToParams(
					sessionId,
					{
						...idleLiveState,
						openInteraction: {
							interactionId: "i1" as never,
							interaction: { kind: "plan_approval", plan: "Change the parser" },
							since: 4,
						},
					},
					5,
				),
			),
		);
		run(
			SESSION_LIVE_STATE_SQL.upsert,
			must(
				liveStateToParams(
					"chat-2" as SessionId,
					{
						...idleLiveState,
						backgroundTasks: [{ id: "task-1", kind: "shell", description: "npm test" }],
					},
					5,
				),
			),
		);

		const report = must(await runStartupRepair(deps()));
		expect(report.liveStatesReset).toBe(2);
		const live = rows<{ live_state: string }>(SESSION_LIVE_STATE_SQL.listAll);
		expect(live.map((row) => JSON.parse(row.live_state))).toEqual([idleLiveState, idleLiveState]);
	});

	it("resets a row whose stored live state is not JSON", async () => {
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		insertWorkspace(sampleWorkspace.id, "ready", null);
		run(SESSIONS_SQL.insert, must(sessionToParams(sampleSession)));
		run("INSERT INTO session_live_state (session_id, live_state, updated_at) VALUES ($1, $2, $3)", [
			sessionId,
			"{broken",
			5,
		]);

		const report = must(await runStartupRepair(deps()));
		expect(report.liveStatesReset).toBe(1);
		const live = rows<{ live_state: string }>(SESSION_LIVE_STATE_SQL.listAll);
		expect(live.map((row) => JSON.parse(row.live_state))).toEqual([idleLiveState]);
	});

	it("resets a row whose stored status cannot be read", async () => {
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		insertWorkspace(sampleWorkspace.id, "ready", null);
		run(SESSIONS_SQL.insert, must(sessionToParams(sampleSession)));
		run("INSERT INTO session_live_state (session_id, live_state, updated_at) VALUES ($1, $2, $3)", [
			sessionId,
			'{"backgroundTasks":[]}',
			5,
		]);

		const report = must(await runStartupRepair(deps()));
		expect(report.liveStatesReset).toBe(1);

		const live = rows<{ live_state: string }>(SESSION_LIVE_STATE_SQL.listAll);
		expect(live.map((row) => JSON.parse(row.live_state))).toEqual([idleLiveState]);
	});
});

describe("DATA-03 startup repair recovers the composer outbox", () => {
	it("drops a delivered message, requeues the rest and pauses the chat", async () => {
		seedCrash();

		const report = must(await runStartupRepair(deps()));
		expect(report).toMatchObject({
			queuedDelivered: 1,
			queuedRequeued: 1,
			chatsPaused: 1,
		});

		expect(
			rows<{ id: string; state: string }>("SELECT id, state FROM queued_messages ORDER BY id"),
		).toEqual([
			{ id: "b", state: "waiting" },
			{ id: "c", state: "failed" },
		]);
		expect(
			rows<{ id: string; queue_paused_at: number | null }>(
				"SELECT id, queue_paused_at FROM sessions ORDER BY id",
			),
		).toEqual([
			{ id: "chat-1", queue_paused_at: 9000 },
			{ id: "chat-2", queue_paused_at: null },
		]);

		const second = must(await runStartupRepair(deps()));
		expect(second).toMatchObject({ queuedDelivered: 0, queuedRequeued: 0, chatsPaused: 0 });
	});
});

describe("DATA-03 startup repair keeps half-built workspaces", () => {
	it("marks a cut-off workspace failed and reports archiving ones without changing them", async () => {
		seedCrash();

		const report = must(await runStartupRepair(deps()));
		expect(report.workspacesFailed).toBe(1);
		expect(report.archivingWorkspaces).toEqual([
			{
				id: "archiving",
				path: "/code/workspaces/archiving",
				archiveCommit: null,
				folderExists: true,
			},
			{
				id: "archiving-gone",
				path: "/code/workspaces/archiving-gone",
				archiveCommit: null,
				folderExists: false,
			},
		]);

		const states = rows<{ id: string; state: string; setup_log_path: string | null }>(
			"SELECT id, state, setup_log_path FROM workspaces ORDER BY id",
		);
		expect(states).toEqual([
			{
				id: "already-failed",
				state: "failed",
				setup_log_path: "/data/setup-logs/already-failed.log",
			},
			{ id: "archiving", state: "archiving", setup_log_path: null },
			{ id: "archiving-gone", state: "archiving", setup_log_path: null },
			{ id: "init", state: "failed", setup_log_path: "/data/setup-logs/init.log" },
			{ id: "ws-1", state: "ready", setup_log_path: null },
		]);

		const second = must(await runStartupRepair(deps()));
		expect(second.workspacesFailed).toBe(0);
	});
});

describe("DATA-03 startup repair closes terminals left open", () => {
	it("gives every open terminal an end time and leaves an ended one alone", async () => {
		seedCrash();
		run(TERMINALS_SQL.insert, terminalToParams({ ...sampleTerminal, id: "term-2" as never }));
		run("UPDATE terminals SET ended_at = 5 WHERE id = 'term-2'");

		const report = must(await runStartupRepair(deps()));
		expect(report.terminalsEnded).toBe(1);
		expect(
			rows<{ id: string; ended_at: number | null }>(
				"SELECT id, ended_at FROM terminals ORDER BY id",
			),
		).toEqual([
			{ id: "term-1", ended_at: 9000 },
			{ id: "term-2", ended_at: 5 },
		]);
	});
});

describe("DATA-03 startup repair is atomic", () => {
	it("changes nothing when a later step fails", async () => {
		seedCrash();
		database = new FailingOnArchivingDatabase(database);

		const result = await runStartupRepair(deps());
		expect(result).toMatchObject({ ok: false, error: { code: "db.failed" } });

		expect(
			rows<{ live_state: string }>(
				"SELECT live_state FROM session_live_state WHERE session_id = $1",
				[sessionId],
			).map((row) => JSON.parse(row.live_state)),
		).toEqual([{ ...idleLiveState, status: "working" }]);
		expect(
			rows<{ total: number }>(
				"SELECT COUNT(*) AS total FROM session_events WHERE type = 'turn_ended'",
			).map((row) => row.total),
		).toEqual([1]);
		expect(
			rows<{ state: string }>("SELECT state FROM queued_messages ORDER BY id").map((r) => r.state),
		).toEqual(["sending", "failed", "sending"]);
	});
});
