/**
 * @feature DATA-01 Repository for the session_events table
 * Owns: the chat's append-only event log: append, read in order, mark reverted, find turns cut
 * off by a crash.
 * Behaviour: sessions.md section 5 (durable events, acknowledgement after the write),
 * services-map.md 2.3.3 (append event, revert events), sessions-and-chats.md "How chats are stored".
 * Must handle: append is idempotent on (session_id, event_id) and assigns the next idx in the same
 * statement, so a replayed event adds nothing and two appends never share an idx; the statement
 * returns a row only when it inserted, so an empty result means "duplicate"; reverting marks
 * events and never deletes them; a bad content column returns an error Result.
 * Test first: appending the same event id twice stores one row, and a new event id gets idx + 1.
 */
import { type SessionEvent, zSessionEvent } from "@conducted/protocol";
import { type EventId, err, ok, type Result, type SessionId, type TurnId } from "@conducted/shared";
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
	listFrom: `SELECT ${COLUMNS} FROM session_events WHERE session_id = $1 AND idx >= $2
		ORDER BY idx LIMIT $3`,
	listByTurn: `SELECT ${COLUMNS} FROM session_events WHERE session_id = $1 AND turn_id = $2
		ORDER BY idx`,
	listUserMessages: `SELECT ${COLUMNS} FROM session_events
		WHERE session_id = $1 AND type = 'user_message' ORDER BY idx`,
	getByEventId: `SELECT ${COLUMNS} FROM session_events WHERE session_id = $1 AND event_id = $2`,
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
	 * so it does not start a second turn.
	 */
	findInterruptedTurns: `SELECT session_id, turn_id FROM session_events
		WHERE reverted_at IS NULL AND turn_id IS NOT NULL
		GROUP BY session_id, turn_id
		HAVING SUM(type = 'user_message') > 0 AND SUM(type = 'turn_ended') = 0
		ORDER BY session_id, MIN(idx)`,
	/** The same query for one chat, so a lost chat does not scan every chat's log. */
	findInterruptedTurnsForSession: `SELECT session_id, turn_id FROM session_events
		WHERE reverted_at IS NULL AND turn_id IS NOT NULL AND session_id = $1
		GROUP BY session_id, turn_id
		HAVING SUM(type = 'user_message') > 0 AND SUM(type = 'turn_ended') = 0
		ORDER BY MIN(idx)`,
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
	/** SESSION_EVENTS_SQL.listFrom. Events with idx >= `fromIdx`, in idx order, at most `limit`. */
	listFrom(
		sessionId: SessionId,
		fromIdx: number,
		limit: number,
	): Promise<Result<StoredSessionEvent[]>>;
	/** SESSION_EVENTS_SQL.listByTurn, in idx order. */
	listByTurn(sessionId: SessionId, turnId: TurnId): Promise<Result<StoredSessionEvent[]>>;
	/** SESSION_EVENTS_SQL.listUserMessages, for the "revert to here" menu. */
	listUserMessages(sessionId: SessionId): Promise<Result<StoredSessionEvent[]>>;
	/** SESSION_EVENTS_SQL.getByEventId. A missing event is `ok(null)`. */
	getByEventId(sessionId: SessionId, eventId: EventId): Promise<Result<StoredSessionEvent | null>>;
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
		listFrom: (sessionId, fromIdx, limit) =>
			list(
				SESSION_EVENTS_SQL.listFrom,
				[sessionId, fromIdx, limit],
				"Listing chat events from a position",
			),
		listByTurn: (sessionId, turnId) =>
			list(SESSION_EVENTS_SQL.listByTurn, [sessionId, turnId], "Listing a turn's events"),
		listUserMessages: (sessionId) =>
			list(SESSION_EVENTS_SQL.listUserMessages, [sessionId], "Listing user messages"),
		getByEventId: async (sessionId, eventId) => {
			const rows = await selectRows<SessionEventRow>(
				db,
				SESSION_EVENTS_SQL.getByEventId,
				[sessionId, eventId],
				"Reading a chat event",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : sessionEventFromRow(row);
		},
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
	};
}
