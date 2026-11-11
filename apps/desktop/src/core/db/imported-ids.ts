/**
 * @feature APP-17 The ids Conducted already holds, for the import's second run
 * @feature APP-18 Chat history from Conductor
 * Owns: `IMPORTED_IDS_SQL` and `readExistingIds`, the chat, review comment and section ids in the
 * database and the number of sections, so the import from Conductor skips a row a previous import
 * brought (an imported row keeps Conductor's id, D124); and the chats that hold any event, whose
 * history the import never adds to (APP-18).
 * Behaviour: docs/plans/migrate-from-conductor.md, safety rule 7 (once per item).
 * Must handle: an empty database gives empty sets and no sections; a chat with events is found
 * by one index lookup per chat, never a scan of every event.
 * Test first: a second import adds nothing that is already there.
 */
import { err, ok, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import { selectRows } from "./row-codec.ts";

export const IMPORTED_IDS_SQL = {
	sessions: "SELECT id FROM sessions",
	comments: "SELECT id FROM diff_comments",
	sections: "SELECT id FROM sections",
	sessionsWithEvents: `SELECT s.id FROM sessions s
		WHERE EXISTS (SELECT 1 FROM session_events e WHERE e.session_id = s.id)`,
} as const;

export interface ExistingIds {
	sessionIds: Set<string>;
	commentIds: Set<string>;
	sectionIds: Set<string>;
	/** Chats that hold an event: imported history, or turns of their own. */
	sessionIdsWithEvents: Set<string>;
}

export async function readExistingIds(db: Database): Promise<Result<ExistingIds>> {
	const read = async (sql: string, what: string): Promise<Result<Set<string>>> => {
		const rows = await selectRows<{ id: string }>(db, sql, [], what);
		return rows.ok ? ok(new Set(rows.value.map((row) => row.id))) : err(rows.error);
	};
	const sessionIds = await read(IMPORTED_IDS_SQL.sessions, "Listing chat ids");
	if (!sessionIds.ok) return sessionIds;
	const commentIds = await read(IMPORTED_IDS_SQL.comments, "Listing review comment ids");
	if (!commentIds.ok) return commentIds;
	const sectionIds = await read(IMPORTED_IDS_SQL.sections, "Listing section ids");
	if (!sectionIds.ok) return sectionIds;
	const withEvents = await read(IMPORTED_IDS_SQL.sessionsWithEvents, "Listing chats with events");
	if (!withEvents.ok) return withEvents;
	return ok({
		sessionIds: sessionIds.value,
		commentIds: commentIds.value,
		sectionIds: sectionIds.value,
		sessionIdsWithEvents: withEvents.value,
	});
}
