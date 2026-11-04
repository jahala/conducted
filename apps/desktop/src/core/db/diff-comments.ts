/**
 * @feature DATA-01 Repository for the diff_comments table
 * Owns: review comments on a workspace diff, from the user, an agent or GitHub.
 * Behaviour: services-map.md 2.3.5 (diff_comments: create or sync from GitHub, resolve thread,
 * delete comments GitHub no longer has). Our table has resolved and outdated flags instead of
 * Conductor's state column.
 * Must handle: a sync from GitHub upserts by id and must not undo a local resolve; threads are
 * resolved together; the sync delete only touches author_kind 'github' rows and receives the ids
 * to keep as a JSON list (no giant IN clause); replies point to their parent by reply_to_id.
 * Test first: diffCommentToParams then diffCommentFromRow gives back the same comment.
 */
import { type CommentId, notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { DiffComment } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import { fromFlag, toFlag } from "./row-codec.ts";

export interface DiffCommentRow {
	id: CommentId;
	workspace_id: WorkspaceId;
	file_path: string;
	line: number | null;
	end_line: number | null;
	body: string;
	author_kind: "user" | "agent" | "github";
	author_name: string | null;
	side: "deletions" | "additions";
	thread_id: string | null;
	reply_to_id: CommentId | null;
	suggestion: string | null;
	remote_url: string | null;
	resolved: number;
	outdated: number;
	created_at: number;
	updated_at: number;
}

export const diffCommentFromRow = (row: DiffCommentRow): DiffComment => ({
	id: row.id,
	workspaceId: row.workspace_id,
	filePath: row.file_path,
	line: row.line,
	endLine: row.end_line,
	body: row.body,
	author: { kind: row.author_kind, name: row.author_name },
	side: row.side,
	threadId: row.thread_id,
	replyToId: row.reply_to_id,
	suggestion: row.suggestion,
	remoteUrl: row.remote_url,
	resolved: fromFlag(row.resolved),
	outdated: fromFlag(row.outdated),
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

/** Parameters for DIFF_COMMENTS_SQL.insert and .upsert, in column order. */
export const diffCommentToParams = (comment: DiffComment): readonly unknown[] => [
	comment.id,
	comment.workspaceId,
	comment.filePath,
	comment.line,
	comment.endLine,
	comment.body,
	comment.author.kind,
	comment.author.name,
	comment.side,
	comment.threadId,
	comment.replyToId,
	comment.suggestion,
	comment.remoteUrl,
	toFlag(comment.resolved),
	toFlag(comment.outdated),
	comment.createdAt,
	comment.updatedAt,
];

const COLUMNS = `id, workspace_id, file_path, line, end_line, body, author_kind, author_name,
	side, thread_id, reply_to_id, suggestion, remote_url, resolved, outdated, created_at, updated_at`;

const VALUES = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const DIFF_COMMENTS_SQL = {
	listByWorkspace: `SELECT ${COLUMNS} FROM diff_comments WHERE workspace_id = $1
		ORDER BY file_path, COALESCE(line, 0), created_at, id`,
	listByFile: `SELECT ${COLUMNS} FROM diff_comments WHERE workspace_id = $1 AND file_path = $2
		ORDER BY COALESCE(line, 0), created_at, id`,
	listByThread: `SELECT ${COLUMNS} FROM diff_comments WHERE workspace_id = $1 AND thread_id = $2
		ORDER BY created_at, id`,
	get: `SELECT ${COLUMNS} FROM diff_comments WHERE id = $1`,
	countOpen: `SELECT COUNT(*) AS total FROM diff_comments
		WHERE workspace_id = $1 AND resolved = 0 AND outdated = 0`,
	insert: `INSERT INTO diff_comments (${COLUMNS}) VALUES (${VALUES})`,
	/**
	 * Sync from GitHub. A comment that exists keeps its local `resolved` flag, so a resolve done
	 * in the app survives a later sync. Text, suggestion, outdated and the link follow GitHub.
	 */
	upsertRemote: `INSERT INTO diff_comments (${COLUMNS}) VALUES (${VALUES})
		ON CONFLICT (id) DO UPDATE SET
			body = excluded.body, suggestion = excluded.suggestion, line = excluded.line,
			end_line = excluded.end_line, outdated = excluded.outdated,
			remote_url = excluded.remote_url, updated_at = excluded.updated_at`,
	setBody: "UPDATE diff_comments SET body = $1, suggestion = $2, updated_at = $3 WHERE id = $4",
	setResolved: "UPDATE diff_comments SET resolved = $1, updated_at = $2 WHERE id = $3",
	setThreadResolved: `UPDATE diff_comments SET resolved = $1, updated_at = $2
		WHERE workspace_id = $3 AND thread_id = $4`,
	setOutdated: "UPDATE diff_comments SET outdated = $1, updated_at = $2 WHERE id = $3",
	setRemoteUrl: "UPDATE diff_comments SET remote_url = $1, updated_at = $2 WHERE id = $3",
	delete: "DELETE FROM diff_comments WHERE id = $1",
	/** `$2` is a JSON list of GitHub comment ids that still exist; all other GitHub rows go. */
	deleteRemoteNotIn: `DELETE FROM diff_comments
		WHERE workspace_id = $1 AND author_kind = 'github'
		AND id NOT IN (SELECT value FROM json_each($2))`,
} as const;

/** What a caller supplies to add a comment. The repository adds id, flags and times. */
export type NewDiffComment = Pick<
	DiffComment,
	| "workspaceId"
	| "filePath"
	| "line"
	| "endLine"
	| "body"
	| "author"
	| "side"
	| "threadId"
	| "replyToId"
	| "suggestion"
>;

export interface DiffCommentRepository {
	/** DIFF_COMMENTS_SQL.listByWorkspace, ordered by file and line. */
	listByWorkspace(workspaceId: WorkspaceId): Promise<Result<DiffComment[]>>;
	/** DIFF_COMMENTS_SQL.listByFile. */
	listByFile(workspaceId: WorkspaceId, filePath: string): Promise<Result<DiffComment[]>>;
	/** DIFF_COMMENTS_SQL.listByThread, oldest first. */
	listByThread(workspaceId: WorkspaceId, threadId: string): Promise<Result<DiffComment[]>>;
	/** DIFF_COMMENTS_SQL.get. A missing comment is `ok(null)`. */
	get(id: CommentId): Promise<Result<DiffComment | null>>;
	/** DIFF_COMMENTS_SQL.countOpen: comments neither resolved nor outdated. */
	countOpen(workspaceId: WorkspaceId): Promise<Result<number>>;
	/** DIFF_COMMENTS_SQL.insert with resolved=false and outdated=false. */
	add(input: NewDiffComment): Promise<Result<DiffComment>>;
	/**
	 * DIFF_COMMENTS_SQL.upsertRemote for each comment, then DIFF_COMMENTS_SQL.deleteRemoteNotIn
	 * with the ids just seen, all in one transaction. Idempotent: running the same sync twice
	 * changes nothing.
	 */
	syncRemote(workspaceId: WorkspaceId, comments: readonly DiffComment[]): Promise<Result<void>>;
	/** DIFF_COMMENTS_SQL.setBody. */
	setBody(id: CommentId, body: string, suggestion: string | null): Promise<Result<void>>;
	/** DIFF_COMMENTS_SQL.setResolved. */
	setResolved(id: CommentId, resolved: boolean): Promise<Result<void>>;
	/** DIFF_COMMENTS_SQL.setThreadResolved. Resolves or reopens the whole thread. */
	setThreadResolved(
		workspaceId: WorkspaceId,
		threadId: string,
		resolved: boolean,
	): Promise<Result<void>>;
	/** DIFF_COMMENTS_SQL.setOutdated, when the commented line changed. */
	setOutdated(id: CommentId, outdated: boolean): Promise<Result<void>>;
	/** DIFF_COMMENTS_SQL.setRemoteUrl, after the comment is posted to GitHub. */
	setRemoteUrl(id: CommentId, url: string | null): Promise<Result<void>>;
	/** DIFF_COMMENTS_SQL.delete. */
	delete(id: CommentId): Promise<Result<void>>;
}

export function createDiffCommentRepository(
	_db: Database,
	_deps: RepositoryDeps,
): DiffCommentRepository {
	return {
		listByWorkspace: async () => notImplemented("DATA-01"),
		listByFile: async () => notImplemented("DATA-01"),
		listByThread: async () => notImplemented("DATA-01"),
		get: async () => notImplemented("DATA-01"),
		countOpen: async () => notImplemented("DATA-01"),
		add: async () => notImplemented("DATA-01"),
		syncRemote: async () => notImplemented("DATA-01"),
		setBody: async () => notImplemented("DATA-01"),
		setResolved: async () => notImplemented("DATA-01"),
		setThreadResolved: async () => notImplemented("DATA-01"),
		setOutdated: async () => notImplemented("DATA-01"),
		setRemoteUrl: async () => notImplemented("DATA-01"),
		delete: async () => notImplemented("DATA-01"),
	};
}
