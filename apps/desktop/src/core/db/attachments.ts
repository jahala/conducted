/**
 * @feature DATA-01 Repository for the attachments table
 * Owns: rows for files attached to a draft or a sent message. The files themselves live under
 * the app data folder. A review attachment also names the comment it carried (REV-12), so a
 * comment can be found from the messages and chats that received it. The review service records
 * one such row, already sent, for each comment it sends to a chat (`addSent`).
 * Behaviour: services-map.md 2.3.5 (attachments: add draft, attach drafts to a message, restore
 * to draft, remove) and 5A.6.2 (draft staging folder).
 * Must handle: attaching drafts to a message is one statement over a JSON list of ids; removing
 * returns the path so the caller can move the file to the Trash; deleting a chat cascades to
 * its rows but not to its files, so the chat-delete service lists paths first; drafts older
 * than 7 days are removed by the lifetime job (lifetime.ts), not here.
 * Test first: attachDrafts only changes drafts of the same chat and leaves other chats alone.
 */
import {
	type AttachmentId,
	type CommentId,
	err,
	ok,
	type Result,
	type SessionId,
} from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Attachment } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	executeExisting,
	executeStatement,
	fromFlag,
	inTransaction,
	selectRows,
	stringifyJson,
	toFlag,
} from "./row-codec.ts";

export interface AttachmentRow {
	id: AttachmentId;
	session_id: SessionId | null;
	message_id: string | null;
	kind: Attachment["kind"];
	original_name: string;
	path: string;
	is_draft: number;
	comment_id: CommentId | null;
	created_at: number;
}

export const attachmentFromRow = (row: AttachmentRow): Attachment => ({
	id: row.id,
	sessionId: row.session_id,
	kind: row.kind,
	originalName: row.original_name,
	path: row.path,
	isDraft: fromFlag(row.is_draft),
	commentId: row.comment_id,
});

/** The model has no message id or time, both columns are written at insert. */
export type AttachmentInsert = Attachment & { messageId: string | null; createdAt: number };

/** Parameters for ATTACHMENTS_SQL.insert, in column order. */
export const attachmentToParams = (attachment: AttachmentInsert): readonly unknown[] => [
	attachment.id,
	attachment.sessionId,
	attachment.messageId,
	attachment.kind,
	attachment.originalName,
	attachment.path,
	toFlag(attachment.isDraft),
	attachment.commentId,
	attachment.createdAt,
];

const COLUMNS =
	"id, session_id, message_id, kind, original_name, path, is_draft, comment_id, created_at";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const ATTACHMENTS_SQL = {
	get: `SELECT ${COLUMNS} FROM attachments WHERE id = $1`,
	listBySession: `SELECT ${COLUMNS} FROM attachments WHERE session_id = $1 ORDER BY created_at, id`,
	listDraftsBySession: `SELECT ${COLUMNS} FROM attachments WHERE session_id = $1 AND is_draft = 1
		ORDER BY created_at, id`,
	insert: `INSERT INTO attachments (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
	setPath: "UPDATE attachments SET path = $1 WHERE id = $2",
	/** `$3` is a JSON list of attachment ids. Only drafts of the given chat are touched. */
	attachDrafts: `UPDATE attachments SET message_id = $1, is_draft = 0
		WHERE session_id = $2 AND is_draft = 1 AND id IN (SELECT value FROM json_each($3))`,
	restoreToDraft: "UPDATE attachments SET message_id = NULL, is_draft = 1 WHERE message_id = $1",
	/** Returns the path so the caller can trash the file. */
	deleteDraftReturningPath:
		"DELETE FROM attachments WHERE id = $1 AND session_id = $2 AND is_draft = 1 RETURNING path",
} as const;

/** What a caller supplies to add a draft attachment. The repository adds id and time. */
export type NewAttachment = Pick<
	Attachment,
	"sessionId" | "kind" | "originalName" | "path" | "commentId"
>;

export interface AttachmentRepository {
	/** ATTACHMENTS_SQL.get. A missing attachment is `ok(null)`. */
	get(id: AttachmentId): Promise<Result<Attachment | null>>;
	/** ATTACHMENTS_SQL.listBySession, oldest first. */
	listBySession(sessionId: SessionId): Promise<Result<Attachment[]>>;
	/** ATTACHMENTS_SQL.listDraftsBySession. */
	listDraftsBySession(sessionId: SessionId): Promise<Result<Attachment[]>>;
	/** ATTACHMENTS_SQL.insert with is_draft=true. */
	addDraft(input: NewAttachment): Promise<Result<Attachment>>;
	/**
	 * ATTACHMENTS_SQL.insert with is_draft=false, for a file a chat already received. It is never
	 * offered as a draft and the draft lifetime job leaves it alone. The message id is null when the
	 * sender does not know it.
	 */
	addSent(input: NewAttachment & { messageId: string | null }): Promise<Result<Attachment>>;
	/** ATTACHMENTS_SQL.setPath, after a file finished copying into the staging folder. */
	setPath(id: AttachmentId, path: string): Promise<Result<void>>;
	/** ATTACHMENTS_SQL.attachDrafts. Returns how many rows changed. */
	attachDrafts(
		sessionId: SessionId,
		messageId: string,
		ids: readonly AttachmentId[],
	): Promise<Result<number>>;
	/** ATTACHMENTS_SQL.restoreToDraft, when a queued message goes back to the composer. */
	restoreToDraft(messageId: string): Promise<Result<number>>;
	/** ATTACHMENTS_SQL.deleteDraftReturningPath. Refuses attachments already sent. */
	removeDraft(sessionId: SessionId, id: AttachmentId): Promise<Result<string | null>>;
}

export function createAttachmentRepository(
	db: Database,
	deps: RepositoryDeps,
): AttachmentRepository {
	const list = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<Attachment[]>> => {
		const rows = await selectRows<AttachmentRow>(db, sql, params, what);
		return rows.ok ? ok(rows.value.map(attachmentFromRow)) : err(rows.error);
	};
	const insert = (
		input: NewAttachment,
		sent: { isDraft: boolean; messageId: string | null },
		what: string,
	): Promise<Result<Attachment>> =>
		inTransaction(db, what, async (tx) => {
			const attachment: AttachmentInsert = {
				id: deps.ids.uuid() as AttachmentId,
				sessionId: input.sessionId,
				kind: input.kind,
				originalName: input.originalName,
				path: input.path,
				isDraft: sent.isDraft,
				commentId: input.commentId,
				messageId: sent.messageId,
				createdAt: deps.clock.now(),
			};
			const written = await executeStatement(
				tx,
				ATTACHMENTS_SQL.insert,
				attachmentToParams(attachment),
				what,
			);
			if (!written.ok) return err(written.error);
			return ok({
				id: attachment.id,
				sessionId: attachment.sessionId,
				kind: attachment.kind,
				originalName: attachment.originalName,
				path: attachment.path,
				isDraft: attachment.isDraft,
				commentId: attachment.commentId,
			});
		});
	return {
		get: async (id) => {
			const rows = await selectRows<AttachmentRow>(
				db,
				ATTACHMENTS_SQL.get,
				[id],
				"Reading an attachment",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : ok(attachmentFromRow(row));
		},
		listBySession: (sessionId) =>
			list(ATTACHMENTS_SQL.listBySession, [sessionId], "Listing attachments"),
		listDraftsBySession: (sessionId) =>
			list(ATTACHMENTS_SQL.listDraftsBySession, [sessionId], "Listing draft attachments"),
		addDraft: (input) =>
			insert(input, { isDraft: true, messageId: null }, "Adding a draft attachment"),
		addSent: (input) =>
			insert(input, { isDraft: false, messageId: input.messageId }, "Recording a sent attachment"),
		setPath: (id, path) =>
			executeExisting(db, ATTACHMENTS_SQL.setPath, [path, id], "Saving an attachment path"),
		attachDrafts: async (sessionId, messageId, ids) => {
			const json = stringifyJson(ids, "attachments.ids");
			if (!json.ok) return err(json.error);
			const written = await executeStatement(
				db,
				ATTACHMENTS_SQL.attachDrafts,
				[messageId, sessionId, json.value],
				"Attaching drafts to a message",
			);
			return written.ok ? ok(written.value) : err(written.error);
		},
		restoreToDraft: async (messageId) => {
			const written = await executeStatement(
				db,
				ATTACHMENTS_SQL.restoreToDraft,
				[messageId],
				"Restoring attachments to a draft",
			);
			return written.ok ? ok(written.value) : err(written.error);
		},
		removeDraft: async (sessionId, id) => {
			const rows = await selectRows<{ path: string }>(
				db,
				ATTACHMENTS_SQL.deleteDraftReturningPath,
				[id, sessionId],
				"Removing a draft attachment",
			);
			return rows.ok ? ok(rows.value[0]?.path ?? null) : err(rows.error);
		},
	};
}
