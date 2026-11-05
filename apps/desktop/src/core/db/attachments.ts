/**
 * @feature DATA-01 Repository for the attachments table
 * Owns: rows for files attached to a draft or a sent message. The files themselves live under
 * the app data folder.
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
	notImplemented,
	type Result,
	type SessionId,
} from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Attachment } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import { fromFlag, toFlag } from "./row-codec.ts";

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
	listByMessage: `SELECT ${COLUMNS} FROM attachments WHERE message_id = $1 ORDER BY created_at, id`,
	insert: `INSERT INTO attachments (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
	/** The attachments that carried a review comment, so the app knows which messages sent it. */
	listByComment: `SELECT ${COLUMNS} FROM attachments WHERE comment_id = $1 ORDER BY created_at, id`,
	setPath: "UPDATE attachments SET path = $1 WHERE id = $2",
	/** `$3` is a JSON list of attachment ids. Only drafts of the given chat are touched. */
	attachDrafts: `UPDATE attachments SET message_id = $1, is_draft = 0
		WHERE session_id = $2 AND is_draft = 1 AND id IN (SELECT value FROM json_each($3))`,
	restoreToDraft: "UPDATE attachments SET message_id = NULL, is_draft = 1 WHERE message_id = $1",
	/** Returns the path so the caller can trash the file. */
	deleteReturningPath: "DELETE FROM attachments WHERE id = $1 RETURNING path",
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
	/** ATTACHMENTS_SQL.listByMessage. */
	listByMessage(messageId: string): Promise<Result<Attachment[]>>;
	/** ATTACHMENTS_SQL.listByComment. */
	listByComment(commentId: CommentId): Promise<Result<Attachment[]>>;
	/** ATTACHMENTS_SQL.insert with is_draft=true. */
	addDraft(input: NewAttachment): Promise<Result<Attachment>>;
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
	/** ATTACHMENTS_SQL.deleteReturningPath, run with `select`. `ok(null)` when it was gone. */
	remove(id: AttachmentId): Promise<Result<string | null>>;
	/** ATTACHMENTS_SQL.deleteDraftReturningPath. Refuses attachments already sent. */
	removeDraft(sessionId: SessionId, id: AttachmentId): Promise<Result<string | null>>;
}

export function createAttachmentRepository(
	_db: Database,
	_deps: RepositoryDeps,
): AttachmentRepository {
	return {
		get: async () => notImplemented("DATA-01"),
		listBySession: async () => notImplemented("DATA-01"),
		listDraftsBySession: async () => notImplemented("DATA-01"),
		listByMessage: async () => notImplemented("DATA-01"),
		listByComment: async () => notImplemented("REV-12"),
		addDraft: async () => notImplemented("DATA-01"),
		setPath: async () => notImplemented("DATA-01"),
		attachDrafts: async () => notImplemented("DATA-01"),
		restoreToDraft: async () => notImplemented("DATA-01"),
		remove: async () => notImplemented("DATA-01"),
		removeDraft: async () => notImplemented("DATA-01"),
	};
}
