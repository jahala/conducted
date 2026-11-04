/**
 * @feature DATA-03 Startup repair
 * Owns: the checks that run once at startup, before any screen reads chats, to clear state a
 * crash or a force quit left behind.
 * Behaviour: services-map.md Part 6 (sessions reset to idle before any UI sees them) and 2.3.1
 * (startup cleanup of workspaces), sessions.md section 8 (a turn cut off by a crash has no end
 * event and the app must repair it).
 * Must handle: everything runs in one transaction, so a crash during repair changes nothing;
 * a cut-off turn gets a `turn_ended` event with outcome `interrupted`, a fresh event id and the
 * current time; queued messages that were being sent go back to waiting unless their user
 * message is already stored, and every chat that still has queued rows is paused so nothing is
 * sent without the user; workspaces stuck in `initializing` become `failed`; workspaces in
 * `archiving` are only reported, because deciding needs the file system; open terminals get an
 * end time; unread counts are not touched; running repair twice changes nothing the second time.
 * Test first: after repair, a chat with a user_message and no turn_ended gains one turn_ended
 * event with outcome "interrupted", and a second run adds none.
 */
import { idleLiveState, type SessionEvent } from "@conducted/protocol";
import {
	type Clock,
	type EventId,
	type IdSource,
	notImplemented,
	type Result,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import type { Database, FileSystem } from "../../platform/platform.ts";
import { SESSION_EVENTS_SQL } from "./session-events.ts";

export const REPAIR_SQL = {
	/** Step 1 (`$1` idle live state as JSON, `$2` now): every stored live state becomes idle. */
	resetLiveStates: "UPDATE session_live_state SET live_state = $1, updated_at = $2",
	/** Step 2a: turns with a user message and no turn_ended, as (session_id, turn_id) rows. */
	findInterruptedTurns: SESSION_EVENTS_SQL.findInterruptedTurns,
	/** Step 2b: appends the turn_ended event for each turn found, with the idempotent append. */
	appendInterruptedEvent: SESSION_EVENTS_SQL.append,
	/**
	 * Step 3a: a message in `sending` whose user_message event is stored was delivered. Its row
	 * goes. The queued id and the event's messageId are the same value.
	 */
	deleteDeliveredQueued: `DELETE FROM queued_messages
		WHERE state = 'sending' AND EXISTS (
			SELECT 1 FROM session_events e
			WHERE e.session_id = queued_messages.session_id AND e.type = 'user_message'
				AND json_extract(e.content, '$.messageId') = queued_messages.id)`,
	/** Step 3b (`$1` now): the rest of the `sending` rows wait again. */
	requeueSending:
		"UPDATE queued_messages SET state = 'waiting', updated_at = $1 WHERE state = 'sending'",
	/** Step 3c (`$1` now): every chat that still has queued rows is paused. */
	pauseChatsWithQueue: `UPDATE sessions SET queue_paused_at = $1
		WHERE queue_paused_at IS NULL
			AND EXISTS (SELECT 1 FROM queued_messages q WHERE q.session_id = sessions.id)`,
	/** Step 4a (`$1` now): workspaces whose setup never finished. */
	failInitializingWorkspaces: `UPDATE workspaces SET state = 'failed', updated_at = $1
		WHERE state = 'initializing'`,
	/** Step 4b: workspaces left in `archiving`, for the caller to decide about. Not changed. */
	listArchivingWorkspaces: `SELECT id, path, archive_commit FROM workspaces
		WHERE state = 'archiving' ORDER BY created_at, id`,
	/** Step 5 (`$1` now): terminals that were open when the app stopped. */
	endOpenTerminals: "UPDATE terminals SET ended_at = $1 WHERE ended_at IS NULL",
} as const;

export interface InterruptedTurnRow {
	session_id: SessionId;
	turn_id: TurnId;
}

export interface ArchivingWorkspaceRow {
	id: WorkspaceId;
	path: string;
	archive_commit: string | null;
}

/** A workspace the archive flow did not finish. The caller checks its folder and branch. */
export interface ArchivingWorkspace {
	id: WorkspaceId;
	path: string;
	archiveCommit: string | null;
}

export const archivingWorkspaceFromRow = (row: ArchivingWorkspaceRow): ArchivingWorkspace => ({
	id: row.id,
	path: row.path,
	archiveCommit: row.archive_commit,
});

/** What repair did, for the log and for the services that start after it. */
export interface RepairReport {
	liveStatesReset: number;
	/** Turns that received an `interrupted` turn_ended event. */
	interruptedTurns: { sessionId: SessionId; turnId: TurnId }[];
	/** Queued messages deleted because their user message was already stored. */
	queuedDelivered: number;
	/** Queued messages moved from sending back to waiting. */
	queuedRequeued: number;
	/** Chats that were paused because they still have queued messages. */
	chatsPaused: number;
	workspacesFailed: number;
	/** Workspaces left in `archiving`; repair does not change them. */
	archivingWorkspaces: ArchivingWorkspace[];
	terminalsEnded: number;
}

/** The event that closes a turn a crash cut off. Pure: the caller supplies the id and time. */
export const interruptedTurnEvent = (
	turnId: TurnId,
	eventId: EventId,
	at: number,
): SessionEvent => ({
	type: "turn_ended",
	eventId,
	at,
	turnId,
	outcome: "interrupted",
});

/** The live state written by step 1, as the JSON text of the `$1` parameter. */
export const idleLiveStateJson = (): string => JSON.stringify(idleLiveState);

export interface RepairDeps {
	db: Database;
	fs: FileSystem;
	clock: Clock;
	ids: IdSource;
}

/**
 * Runs steps 1 to 5 of REPAIR_SQL in order inside `db.transaction`. For step 2 it loops in
 * TypeScript over the turns the SQL returns and appends one event per turn with
 * `interruptedTurnEvent`, a new id from `ids` and the time from `clock`. Step 6 (unread counts)
 * does nothing on purpose.
 */
export async function runStartupRepair(_deps: RepairDeps): Promise<Result<RepairReport>> {
	return notImplemented("DATA-03");
}
