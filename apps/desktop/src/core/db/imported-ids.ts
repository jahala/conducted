/**
 * @feature APP-17 The ids Conducted already holds, for the import's second run
 * Owns: `IMPORTED_IDS_SQL` and `readExistingIds`, the chat, review comment and section ids in the
 * database and the number of sections, so the import from Conductor skips a row a previous import
 * brought (an imported row keeps Conductor's id, D124).
 * Behaviour: docs/plans/migrate-from-conductor.md, safety rule 7 (once per item).
 * Must handle: an empty database gives empty sets and no sections.
 * Test first: a second import adds nothing that is already there.
 */
import { err, ok, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import { selectRows } from "./row-codec.ts";

export const IMPORTED_IDS_SQL = {
	sessions: "SELECT id FROM sessions",
	comments: "SELECT id FROM diff_comments",
	sections: "SELECT id FROM sections",
} as const;

export interface ExistingIds {
	sessionIds: Set<string>;
	commentIds: Set<string>;
	sectionIds: Set<string>;
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
	return ok({
		sessionIds: sessionIds.value,
		commentIds: commentIds.value,
		sectionIds: sectionIds.value,
	});
}
