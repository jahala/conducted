/**
 * @feature DATA-01 Repository for the session_events table
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * @feature APP-18 Chat history from Conductor
 * Owns: the chat's append-only event log: append, append many in one statement (an imported
 * chat's history, APP-18), read in order, mark reverted, find turns cut off by a crash, and sum a
 * workspace's reported agent cost; `storedEventBytes`, what one appended event takes in the table,
 * which the Conductor import's dry run sums (D132).
 * Behaviour: sessions.md section 5 (durable events, acknowledgement after the write),
 * services-map.md 2.3.3 (append event, revert events), sessions-and-chats.md "How chats are stored".
 * Must handle: append is idempotent on (session_id, event_id) and assigns the next idx in the same
 * statement, so a replayed event adds nothing and two appends never share an idx; the statement
 * returns a row only when it inserted, so an empty result means "duplicate"; appending many
 * keeps their order after the chat's last idx and reports how many it inserted, so a duplicate
 * shows as a shortfall; reverting marks
 * events and never deletes them; a bad content column returns an error Result.
 * Test first: appending the same event id twice stores one row, and a new event id gets idx + 1.
 */
import { type SessionEvent, zSessionEvent } from "@conducted/protocol";
import {
	type EventId,
	err,
	ok,
	type Result,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	collectResults,
	executeStatement,
	parseJsonColumn,
	selectRows,
	stringifyJson,
} from "./row-codec.ts";

export interface SessionEventRow {
	session_id: SessionId;
	idx: number;
	event_id: EventId;
	type: SessionEvent["type"];
	turn_id: TurnId;
	content: string;
	received_at: number;
	reverted_at: number | null;
}

/** A stored event with its place in the log. */
export interface StoredSessionEvent {
	sessionId: SessionId;
	idx: number;
	eventId: EventId;
	turnId: TurnId;
	receivedAt: number;
	revertedAt: number | null;
	event: SessionEvent;
}

/** The answer of an append. `duplicate` means the event id was already stored. */
export type AppendOutcome = { kind: "appended"; idx: number } | { kind: "duplicate" };

export function sessionEventFromRow(row: SessionEventRow): Result<StoredSessionEvent> {
	const event = parseJsonColumn(row.content, zSessionEvent, "session_events.content");
	if (!event.ok) return event;
	return {
		ok: true,
		value: {
			sessionId: row.session_id,
			idx: row.idx,
			eventId: row.event_id,
			turnId: row.turn_id,
			receivedAt: row.received_at,
			revertedAt: row.reverted_at,
			event: event.value,
		},
	};
}

/** Parameters for SESSION_EVENTS_SQL.append: session, event id, type, turn id, content, time. */
export function sessionEventToParams(
	sessionId: SessionId,
	event: SessionEvent,
	receivedAt: number,
): Result<readonly unknown[]> {
	const content = stringifyJson(event, "session_events.content");
	if (!content.ok) return content;
	return {
		ok: true,
		value: [sessionId, event.eventId, event.type, event.turnId, content.value, receivedAt],
	};
}

/** The text columns `appendMany` writes for one event: event id, type, turn id, content. */
type StoredColumns = [string, string, string, string];

function storedColumns(event: SessionEvent): Result<StoredColumns> {
	const content = stringifyJson(event, "session_events.content");
	if (!content.ok) return content;
	return ok([event.eventId, event.type, event.turnId, content.value]);
}

/** UTF-8 bytes of a text, counted without encoding it. */
function utf8Bytes(text: string): number {
	let bytes = 0;
	for (let index = 0; index < text.length; index++) {
		const unit = text.charCodeAt(index);
		if (unit < 0x80) bytes += 1;
		else if (unit < 0x800) bytes += 2;
		else if (unit >= 0xd800 && unit < 0xdc00 && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
			// A surrogate pair is one character of four bytes.
			bytes += 4;
			index++;
		} else bytes += 3;
	}
	return bytes;
}

/** The two whole-number columns, idx and received_at, at SQLite's widest. */
const NUMBER_COLUMNS_BYTES = 16;

/**
 * The table's indexes (migrations 0001 and 0010), each by the text columns its entries repeat:
 * the primary key (session_id, idx), the unique (session_id, event_id), idx_session_events_turn
 * (session_id, turn_id) and idx_session_events_unreverted_turn (reverted_at, session_id, turn_id,
 * type, idx). A test lists the table's indexes, so a new one fails until it is counted here.
 */
export const SESSION_EVENT_INDEXES = [
	"sqlite_autoindex_session_events_1",
	"sqlite_autoindex_session_events_2",
	"idx_session_events_turn",
	"idx_session_events_unreverted_turn",
] as const;

/** What one appended event stores: its row, and the text its index entries repeat. */
export interface StoredEventBytes {
	/** The row's text columns as UTF-8 and its numbers. */
	row: number;
	/** The text the four index entries hold, as UTF-8; their numbers are SQLite's page format. */
	indexKeys: number;
}

/**
 * The bytes `appendMany` stores for this event, before SQLite's pages (APP-18, D132). The
 * Conductor import's dry run sums them.
 */
export function storedEventBytes(
	sessionId: SessionId,
	event: SessionEvent,
): Result<StoredEventBytes> {
	const columns = storedColumns(event);
	if (!columns.ok) return columns;
	const [eventId, type, turnId, content] = columns.value.map(utf8Bytes) as [
		number,
		number,
		number,
		number,
	];
	const session = utf8Bytes(sessionId);
	const row = session + eventId + type + turnId + content + NUMBER_COLUMNS_BYTES;
	return ok({ row, indexKeys: 4 * session + eventId + 2 * turnId + type });
}

const COLUMNS = "session_id, idx, event_id, type, turn_id, content, received_at, reverted_at";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const SESSION_EVENTS_SQL = {
	/**
	 * Idempotent append. The aggregate SELECT always yields one row, so the insert is attempted
	 * once; the conflict clause drops it when the event id exists, and RETURNING then gives no row.
	 * The WHERE clause also keeps the parser from reading ON CONFLICT as a join condition.
	 * Run it with `select`, not `execute`, because the answer is in the returned row.
	 */
	append: `INSERT INTO session_events (session_id, idx, event_id, type, turn_id, content, received_at)
		SELECT $1, COALESCE(MAX(idx), -1) + 1, $2, $3, $4, $5, $6
		FROM session_events WHERE session_id = $1
		ON CONFLICT (session_id, event_id) DO NOTHING
		RETURNING idx`,
	/**
	 * Appends `$3`, a JSON list of `[eventId, type, turnId, content]`, after the chat's last idx, in
	 * the list's order, all received at `$2`. An event id the chat holds is dropped, so the count
	 * of rows changed says how many were new. The WHERE clause keeps the parser from reading ON
	 * CONFLICT as a join condition.
	 */
	appendMany: `INSERT INTO session_events (session_id, idx, event_id, type, turn_id, content, received_at)
		SELECT $1, base.next + item.key, json_extract(item.value, '$[0]'),
			json_extract(item.value, '$[1]'), json_extract(item.value, '$[2]'),
			json_extract(item.value, '$[3]'), $2
		FROM json_each($3) AS item,
			(SELECT COALESCE(MAX(idx), -1) + 1 AS next FROM session_events WHERE session_id = $1) AS base
		WHERE true
		ON CONFLICT (session_id, event_id) DO NOTHING`,
	count: "SELECT COUNT(*) AS n FROM session_events WHERE session_id = $1",
	listFrom: `SELECT ${COLUMNS} FROM session_events WHERE session_id = $1 AND idx >= $2
		ORDER BY idx LIMIT $3`,
	listByTurn: `SELECT ${COLUMNS} FROM session_events WHERE session_id = $1 AND turn_id = $2
		ORDER BY idx`,
	lastIdx: "SELECT MAX(idx) AS last_idx FROM session_events WHERE session_id = $1",
	/**
	 * Marks every live event from the first user message of the given turn onward. Events that are
	 * already reverted keep their first revert time. If the turn has no user message the subquery
	 * is NULL and nothing changes.
	 */
	markRevertedFromTurn: `UPDATE session_events SET reverted_at = $1
		WHERE session_id = $2 AND reverted_at IS NULL AND idx >= (
			SELECT MIN(idx) FROM session_events
			WHERE session_id = $2 AND turn_id = $3 AND type = 'user_message')`,
	/**
	 * Turns that have a user message but no turn_ended event, in log order. Reverted turns are
	 * history, not work cut off by a crash, so they are left out. An event with no turn is not a
	 * turn either. Our design choice: a steer message carries the turn id of the turn it steers,
	 * so it does not start a second turn. This is the startup repair query, so it reads local
	 * chats only, through their workspace's host (CLOUD-13).
	 */
	findInterruptedTurns: `SELECT session_id, turn_id FROM session_events
		WHERE reverted_at IS NULL AND turn_id IS NOT NULL
			AND session_id IN (SELECT s.id FROM sessions s
				JOIN workspaces w ON w.id = s.workspace_id WHERE w.host_kind = 'local')
		GROUP BY session_id, turn_id
		HAVING SUM(type = 'user_message') > 0 AND SUM(type = 'turn_ended') = 0
		ORDER BY session_id, MIN(idx)`,
	/** The same query for one chat, so a lost chat does not scan every chat's log. */
	findInterruptedTurnsForSession: `SELECT session_id, turn_id FROM session_events
		WHERE reverted_at IS NULL AND turn_id IS NOT NULL AND session_id = $1
		GROUP BY session_id, turn_id
		HAVING SUM(type = 'user_message') > 0 AND SUM(type = 'turn_ended') = 0
		ORDER BY MIN(idx)`,
	/**
	 * The estimated cost of every agent turn a workspace's chats reported, in US dollars. A usage
	 * item without a cost adds nothing; a reverted turn is history, so it is left out. This backs
	 * the cloud header's "Agent cost" (CLOUD-15), which Conductor reads from its hosted backend.
	 */
	workspaceCost: `SELECT COALESCE(SUM(json_extract(item.value, '$.costUsd')), 0) AS cost_usd
		FROM session_events e
		JOIN sessions s ON s.id = e.session_id
		JOIN workspaces w ON w.id = s.workspace_id
		JOIN json_each(e.content, '$.message.items') item
		WHERE w.id = $1 AND e.type = 'agent' AND e.reverted_at IS NULL
			AND json_extract(item.value, '$.kind') = 'usage'
			AND json_extract(item.value, '$.costUsd') IS NOT NULL`,
} as const;

export interface SessionEventRepository {
	/**
	 * SESSION_EVENTS_SQL.append, run with `select`. One row back means `appended` with its idx;
	 * no row means `duplicate`. Callers acknowledge the event to the sidecar in both cases.
	 */
	append(
		sessionId: SessionId,
		event: SessionEvent,
		receivedAt: number,
	): Promise<Result<AppendOutcome>>;
	/**
	 * SESSION_EVENTS_SQL.appendMany: the events after the chat's last idx, in order, received at
	 * `receivedAt`. Answers how many it inserted; fewer than given means some ids were there.
	 */
	appendMany(
		sessionId: SessionId,
		events: readonly SessionEvent[],
		receivedAt: number,
	): Promise<Result<number>>;
	/** SESSION_EVENTS_SQL.count: how many events the chat holds. */
	count(sessionId: SessionId): Promise<Result<number>>;
	/** SESSION_EVENTS_SQL.listFrom. Events with idx >= `fromIdx`, in idx order, at most `limit`. */
	listFrom(
		sessionId: SessionId,
		fromIdx: number,
		limit: number,
	): Promise<Result<StoredSessionEvent[]>>;
	/** SESSION_EVENTS_SQL.listByTurn, in idx order. */
	listByTurn(sessionId: SessionId, turnId: TurnId): Promise<Result<StoredSessionEvent[]>>;
	/** SESSION_EVENTS_SQL.lastIdx. `ok(null)` for a chat with no events. */
	lastIdx(sessionId: SessionId): Promise<Result<number | null>>;
	/**
	 * SESSION_EVENTS_SQL.markRevertedFromTurn. Returns how many events were marked. Events stay
	 * in the log; only reverted_at is set.
	 */
	markRevertedFromTurn(
		sessionId: SessionId,
		turnId: TurnId,
		revertedAt: number,
	): Promise<Result<number>>;
	/**
	 * SESSION_EVENTS_SQL.findInterruptedTurns across all chats, for startup repair. With a
	 * `sessionId`, only that chat's log is read.
	 */
	findInterruptedTurns(
		sessionId?: SessionId,
	): Promise<Result<{ sessionId: SessionId; turnId: TurnId }[]>>;
	/** SESSION_EVENTS_SQL.workspaceCost. Zero when no turn reported a cost. */
	workspaceCost(workspaceId: WorkspaceId): Promise<Result<number>>;
}

export function createSessionEventRepository(
	db: Database,
	_deps: RepositoryDeps,
): SessionEventRepository {
	const list = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<StoredSessionEvent[]>> => {
		const rows = await selectRows<SessionEventRow>(db, sql, params, what);
		return rows.ok ? collectResults(rows.value.map(sessionEventFromRow)) : err(rows.error);
	};
	return {
		append: async (sessionId, event, receivedAt) => {
			const params = sessionEventToParams(sessionId, event, receivedAt);
			if (!params.ok) return err(params.error);
			const rows = await selectRows<{ idx: number }>(
				db,
				SESSION_EVENTS_SQL.append,
				params.value,
				"Appending a chat event",
			);
			if (!rows.ok) return err(rows.error);
			const idx = rows.value[0]?.idx;
			return ok(idx === undefined ? { kind: "duplicate" } : { kind: "appended", idx });
		},
		appendMany: async (sessionId, events, receivedAt) => {
			if (events.length === 0) return ok(0);
			const entries: StoredColumns[] = [];
			for (const event of events) {
				const columns = storedColumns(event);
				if (!columns.ok) return err(columns.error);
				entries.push(columns.value);
			}
			const list = stringifyJson(entries, "session_events batch");
			if (!list.ok) return err(list.error);
			return executeStatement(
				db,
				SESSION_EVENTS_SQL.appendMany,
				[sessionId, receivedAt, list.value],
				"Appending chat events",
			);
		},
		count: async (sessionId) => {
			const rows = await selectRows<{ n: number }>(
				db,
				SESSION_EVENTS_SQL.count,
				[sessionId],
				"Counting chat events",
			);
			return rows.ok ? ok(Number(rows.value[0]?.n ?? 0)) : err(rows.error);
		},
		listFrom: (sessionId, fromIdx, limit) =>
			list(
				SESSION_EVENTS_SQL.listFrom,
				[sessionId, fromIdx, limit],
				"Listing chat events from a position",
			),
		listByTurn: (sessionId, turnId) =>
			list(SESSION_EVENTS_SQL.listByTurn, [sessionId, turnId], "Listing a turn's events"),
		lastIdx: async (sessionId) => {
			const rows = await selectRows<{ last_idx: number | null }>(
				db,
				SESSION_EVENTS_SQL.lastIdx,
				[sessionId],
				"Reading the last event position",
			);
			if (!rows.ok) return err(rows.error);
			return ok(rows.value[0]?.last_idx ?? null);
		},
		markRevertedFromTurn: async (sessionId, turnId, revertedAt) => {
			const written = await executeStatement(
				db,
				SESSION_EVENTS_SQL.markRevertedFromTurn,
				[revertedAt, sessionId, turnId],
				"Reverting chat events",
			);
			return written.ok ? ok(written.value) : err(written.error);
		},
		findInterruptedTurns: async (sessionId?: SessionId) => {
			const rows = await selectRows<{ session_id: SessionId; turn_id: TurnId }>(
				db,
				sessionId === undefined
					? SESSION_EVENTS_SQL.findInterruptedTurns
					: SESSION_EVENTS_SQL.findInterruptedTurnsForSession,
				sessionId === undefined ? [] : [sessionId],
				"Finding interrupted turns",
			);
			return rows.ok
				? ok(rows.value.map((row) => ({ sessionId: row.session_id, turnId: row.turn_id })))
				: err(rows.error);
		},
		workspaceCost: async (workspaceId) => {
			const rows = await selectRows<{ cost_usd: number }>(
				db,
				SESSION_EVENTS_SQL.workspaceCost,
				[workspaceId],
				"Reading a workspace's agent cost",
			);
			return rows.ok ? ok(rows.value[0]?.cost_usd ?? 0) : err(rows.error);
		},
	};
}
