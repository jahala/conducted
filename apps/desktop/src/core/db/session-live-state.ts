/**
 * @feature DATA-01 Repository for the session_live_state table
 * Owns: the last known live state of each chat, kept so a restart can show it before the sidecar
 * answers.
 * Behaviour: sessions.md section 2 "Status and state literals", services-map.md 2.3.3 (patch live
 * state) and Part 6 (sessions reset to idle before any screen sees them).
 * Must handle: only the newest write wins (a write with an older updated_at is dropped); a bad
 * live_state column returns an error Result; startup repair resets every row (see repair.ts).
 * Test first: upserting with an older updated_at than the stored row leaves the row unchanged.
 */
import { type LiveState, zLiveState } from "@conducted/protocol";
import { notImplemented, type Result, type SessionId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import { parseJsonColumn, stringifyJson } from "./row-codec.ts";

export interface SessionLiveStateRow {
	session_id: SessionId;
	live_state: string;
	updated_at: number;
}

export interface StoredLiveState {
	sessionId: SessionId;
	liveState: LiveState;
	updatedAt: number;
}

export function liveStateFromRow(row: SessionLiveStateRow): Result<StoredLiveState> {
	const liveState = parseJsonColumn(row.live_state, zLiveState, "session_live_state.live_state");
	if (!liveState.ok) return liveState;
	return {
		ok: true,
		value: { sessionId: row.session_id, liveState: liveState.value, updatedAt: row.updated_at },
	};
}

/** Parameters for SESSION_LIVE_STATE_SQL.upsert, in column order. */
export function liveStateToParams(
	sessionId: SessionId,
	liveState: LiveState,
	updatedAt: number,
): Result<readonly unknown[]> {
	const json = stringifyJson(liveState, "session_live_state.live_state");
	if (!json.ok) return json;
	return { ok: true, value: [sessionId, json.value, updatedAt] };
}

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const SESSION_LIVE_STATE_SQL = {
	get: "SELECT session_id, live_state, updated_at FROM session_live_state WHERE session_id = $1",
	listAll: "SELECT session_id, live_state, updated_at FROM session_live_state ORDER BY session_id",
	/** The WHERE clause on the conflict branch drops a write that is older than the stored one. */
	upsert: `INSERT INTO session_live_state (session_id, live_state, updated_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (session_id) DO UPDATE
		SET live_state = excluded.live_state, updated_at = excluded.updated_at
		WHERE excluded.updated_at >= session_live_state.updated_at`,
	delete: "DELETE FROM session_live_state WHERE session_id = $1",
} as const;

export interface SessionLiveStateRepository {
	/** SESSION_LIVE_STATE_SQL.get. A chat with no stored state is `ok(null)`. */
	get(sessionId: SessionId): Promise<Result<StoredLiveState | null>>;
	/** SESSION_LIVE_STATE_SQL.listAll, for the first paint after a restart. */
	listAll(): Promise<Result<StoredLiveState[]>>;
	/**
	 * SESSION_LIVE_STATE_SQL.upsert. Returns `ok(true)` when the row was written and `ok(false)`
	 * when a newer row already existed (rowsAffected is 0).
	 */
	upsert(sessionId: SessionId, liveState: LiveState, updatedAt: number): Promise<Result<boolean>>;
	/** SESSION_LIVE_STATE_SQL.delete. */
	delete(sessionId: SessionId): Promise<Result<void>>;
}

export function createSessionLiveStateRepository(
	_db: Database,
	_deps: RepositoryDeps,
): SessionLiveStateRepository {
	return {
		get: async () => notImplemented("DATA-01"),
		listAll: async () => notImplemented("DATA-01"),
		upsert: async () => notImplemented("DATA-01"),
		delete: async () => notImplemented("DATA-01"),
	};
}
