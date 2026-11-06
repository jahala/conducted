/**
 * @feature DATA-01 Repository for the diff_comments table
 * Owns: review comments on a workspace diff, from the user, an agent or GitHub.
 * Behaviour: services-map.md 2.3.5 (diff_comments: create or sync from GitHub, resolve thread,
 * delete comments GitHub no longer has) and 5A.7.1 (state moves, upsert rules). The review state
 * (REV-12) is its own column since migration 0004; resolved and outdated stay flags. A comment on
 * the pull request itself has location 'pull_request' and an empty file_path, which the model
 * shows as a null file path.
 * Must handle: a sync from GitHub upserts by id and must not undo a local resolve; a sync never
 * rewrites a comment that belongs to another workspace, and refuses a list that names one; a
 * hidden or reviewed comment stays put until GitHub edits its body, then returns to pending; a
 * superseded comment is never updated or deleted, hidden or brought back; only a hidden comment
 * is brought back, and it returns to pending; comments sent to a chat are marked reviewed in one
 * statement; a setter on a missing comment returns `db.not_found`; threads are resolved together;
 * every pending open comment can be made ready, and a workspace's comments can be superseded, in
 * one statement; the sync delete only touches
 * author_kind 'github' rows and receives the ids to keep as a JSON list (no giant IN clause);
 * replies point to their parent by reply_to_id.
 * Test first: diffCommentToParams then diffCommentFromRow gives back the same comment.
 */
import {
	appError,
	type CommentId,
	err,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { DiffComment, ReviewCommentState } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	executeExisting,
	executeStatement,
	executeVoid,
	fromFlag,
	inTransaction,
	selectRows,
	stringifyJson,
	toFlag,
} from "./row-codec.ts";

export interface DiffCommentRow {
	id: CommentId;
	workspace_id: WorkspaceId;
	file_path: string;
	line: number | null;
	end_line: number | null;
	body: string;
	author_kind: "user" | "agent" | "github";
	author_name: string | null;
	author_avatar_url: string | null;
	side: "deletions" | "additions";
	thread_id: string | null;
	reply_to_id: CommentId | null;
	suggestion: string | null;
	remote_url: string | null;
	resolved: number;
	outdated: number;
	state: ReviewCommentState;
	location: "file" | "pull_request";
	created_at: number;
	updated_at: number;
}

export const diffCommentFromRow = (row: DiffCommentRow): DiffComment => ({
	id: row.id,
	workspaceId: row.workspace_id,
	filePath: row.location === "pull_request" ? null : row.file_path,
	line: row.line,
	endLine: row.end_line,
	body: row.body,
	author: { kind: row.author_kind, name: row.author_name, avatarUrl: row.author_avatar_url },
	state: row.state,
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
	comment.filePath ?? "",
	comment.line,
	comment.endLine,
	comment.body,
	comment.author.kind,
	comment.author.name,
	comment.author.avatarUrl,
	comment.side,
	comment.threadId,
	comment.replyToId,
	comment.suggestion,
	comment.remoteUrl,
	toFlag(comment.resolved),
	toFlag(comment.outdated),
	comment.state,
	comment.filePath === null ? "pull_request" : "file",
	comment.createdAt,
	comment.updatedAt,
];

const COLUMNS = `id, workspace_id, file_path, line, end_line, body, author_kind, author_name,
	author_avatar_url, side, thread_id, reply_to_id, suggestion, remote_url, resolved, outdated,
	state, location, created_at, updated_at`;

const VALUES =
	"$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20";

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
	 * A hidden or reviewed comment is left alone until GitHub changes its body; then it returns to
	 * `pending`. A superseded comment is never updated.
	 */
	upsertRemote: `INSERT INTO diff_comments (${COLUMNS}) VALUES (${VALUES})
		ON CONFLICT (id) DO UPDATE SET
			state = CASE
				WHEN diff_comments.state IN ('hidden', 'reviewed') THEN 'pending'
				ELSE diff_comments.state
			END,
			body = excluded.body, suggestion = excluded.suggestion, line = excluded.line,
			end_line = excluded.end_line, outdated = excluded.outdated,
			remote_url = excluded.remote_url, author_avatar_url = excluded.author_avatar_url,
			updated_at = excluded.updated_at
		WHERE diff_comments.workspace_id = excluded.workspace_id
		AND (
			diff_comments.state NOT IN ('hidden', 'reviewed', 'superseded')
			OR (diff_comments.state IN ('hidden', 'reviewed') AND diff_comments.body <> excluded.body)
		)`,
	setBody: "UPDATE diff_comments SET body = $1, suggestion = $2, updated_at = $3 WHERE id = $4",
	setResolved: "UPDATE diff_comments SET resolved = $1, updated_at = $2 WHERE id = $3",
	setState: "UPDATE diff_comments SET state = $1, updated_at = $2 WHERE id = $3",
	/** Hides a comment. A superseded comment stays frozen. */
	hide: `UPDATE diff_comments SET state = 'hidden', updated_at = $1
		WHERE id = $2 AND state <> 'superseded'`,
	/** Brings a hidden comment back as pending (services-map.md 5A.7.1, `unhideComment`). */
	unhide: `UPDATE diff_comments SET state = 'pending', updated_at = $1
		WHERE id = $2 AND state = 'hidden'`,
	/** `$2` is a JSON list of comment ids. Every one that is not superseded becomes reviewed. */
	markReviewed: `UPDATE diff_comments SET state = 'reviewed', updated_at = $1
		WHERE id IN (SELECT value FROM json_each($2)) AND state <> 'superseded'`,
	/** Every pending, open comment of the workspace becomes ready for review. */
	markReadyForReview: `UPDATE diff_comments SET state = 'ready_for_review', updated_at = $1
		WHERE workspace_id = $2 AND state = 'pending' AND resolved = 0 AND outdated = 0`,
	/** Every comment of the workspace becomes superseded, so an older review freezes as one. */
	supersedeWorkspace: `UPDATE diff_comments SET state = 'superseded', updated_at = $1
		WHERE workspace_id = $2 AND state <> 'superseded'`,
	setThreadResolved: `UPDATE diff_comments SET resolved = $1, updated_at = $2
		WHERE workspace_id = $3 AND thread_id = $4`,
	setOutdated: "UPDATE diff_comments SET outdated = $1, updated_at = $2 WHERE id = $3",
	setRemoteUrl: "UPDATE diff_comments SET remote_url = $1, updated_at = $2 WHERE id = $3",
	delete: "DELETE FROM diff_comments WHERE id = $1",
	/**
	 * `$2` is a JSON list of GitHub comment ids that still exist; all other GitHub rows go, except
	 * superseded ones, which stay frozen.
	 */
	deleteRemoteNotIn: `DELETE FROM diff_comments
		WHERE workspace_id = $1 AND author_kind = 'github' AND state <> 'superseded'
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
	/** DIFF_COMMENTS_SQL.insert with resolved=false, outdated=false and state "pending". */
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
	/** DIFF_COMMENTS_SQL.setState: hide, mark ready, reviewed or superseded (REV-12). */
	setState(id: CommentId, state: ReviewCommentState): Promise<Result<void>>;
	/** DIFF_COMMENTS_SQL.hide. False when the comment is superseded or missing. */
	hide(id: CommentId): Promise<Result<boolean>>;
	/** DIFF_COMMENTS_SQL.unhide. False when the comment was not hidden. */
	unhide(id: CommentId): Promise<Result<boolean>>;
	/** DIFF_COMMENTS_SQL.markReviewed, one statement for all the ids. Returns how many changed. */
	markReviewed(ids: readonly CommentId[]): Promise<Result<number>>;
	/** DIFF_COMMENTS_SQL.markReadyForReview: pending, open comments become ready. */
	markReadyForReview(workspaceId: WorkspaceId): Promise<Result<number>>;
	/** DIFF_COMMENTS_SQL.supersedeWorkspace: every comment of the workspace is superseded. */
	supersedeWorkspace(workspaceId: WorkspaceId): Promise<Result<number>>;
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
	db: Database,
	deps: RepositoryDeps,
): DiffCommentRepository {
	const now = (): number => deps.clock.now();
	const list = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<DiffComment[]>> => {
		const rows = await selectRows<DiffCommentRow>(db, sql, params, what);
		return rows.ok ? ok(rows.value.map(diffCommentFromRow)) : err(rows.error);
	};
	return {
		listByWorkspace: (workspaceId) =>
			list(DIFF_COMMENTS_SQL.listByWorkspace, [workspaceId], "Listing review comments"),
		listByFile: (workspaceId, filePath) =>
			list(DIFF_COMMENTS_SQL.listByFile, [workspaceId, filePath], "Listing a file's comments"),
		listByThread: (workspaceId, threadId) =>
			list(DIFF_COMMENTS_SQL.listByThread, [workspaceId, threadId], "Listing a comment thread"),
		get: async (id) => {
			const rows = await selectRows<DiffCommentRow>(
				db,
				DIFF_COMMENTS_SQL.get,
				[id],
				"Reading a review comment",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : ok(diffCommentFromRow(row));
		},
		countOpen: async (workspaceId) => {
			const rows = await selectRows<{ total: number }>(
				db,
				DIFF_COMMENTS_SQL.countOpen,
				[workspaceId],
				"Counting open review comments",
			);
			return rows.ok ? ok(rows.value[0]?.total ?? 0) : err(rows.error);
		},
		add: async (input) =>
			inTransaction(db, "Adding a review comment", async (tx) => {
				const at = now();
				const comment: DiffComment = {
					id: deps.ids.uuid() as CommentId,
					workspaceId: input.workspaceId,
					filePath: input.filePath,
					line: input.line,
					endLine: input.endLine,
					body: input.body,
					author: input.author,
					state: "pending",
					side: input.side,
					threadId: input.threadId,
					replyToId: input.replyToId,
					suggestion: input.suggestion,
					remoteUrl: null,
					resolved: false,
					outdated: false,
					createdAt: at,
					updatedAt: at,
				};
				const written = await executeStatement(
					tx,
					DIFF_COMMENTS_SQL.insert,
					diffCommentToParams(comment),
					"Adding a review comment",
				);
				return written.ok ? ok(comment) : err(written.error);
			}),
		syncRemote: async (workspaceId, comments) => {
			const stranger = comments.find((comment) => comment.workspaceId !== workspaceId);
			if (stranger !== undefined) {
				return err(
					appError(
						"db.invalid_row",
						`Review comment ${stranger.id} belongs to another workspace than the one being synced`,
					),
				);
			}
			return inTransaction(db, "Syncing review comments", async (tx) => {
				for (const comment of comments) {
					const written = await executeStatement(
						tx,
						DIFF_COMMENTS_SQL.upsertRemote,
						diffCommentToParams(comment),
						"Syncing a review comment",
					);
					if (!written.ok) return err(written.error);
				}
				const ids = stringifyJson(
					comments.map((comment) => comment.id),
					"diff_comments.ids",
				);
				if (!ids.ok) return err(ids.error);
				const removed = await executeStatement(
					tx,
					DIFF_COMMENTS_SQL.deleteRemoteNotIn,
					[workspaceId, ids.value],
					"Removing review comments GitHub no longer has",
				);
				return removed.ok ? ok(undefined) : err(removed.error);
			});
		},
		setBody: (id, body, suggestion) =>
			executeExisting(
				db,
				DIFF_COMMENTS_SQL.setBody,
				[body, suggestion, now(), id],
				"Editing a review comment",
			),
		setResolved: (id, resolved) =>
			executeExisting(
				db,
				DIFF_COMMENTS_SQL.setResolved,
				[toFlag(resolved), now(), id],
				"Resolving a review comment",
			),
		setState: (id, state) =>
			executeExisting(
				db,
				DIFF_COMMENTS_SQL.setState,
				[state, now(), id],
				"Changing a review comment's state",
			),
		hide: async (id) => {
			const hidden = await executeStatement(
				db,
				DIFF_COMMENTS_SQL.hide,
				[now(), id],
				"Hiding a review comment",
			);
			return hidden.ok ? ok(hidden.value > 0) : err(hidden.error);
		},
		unhide: async (id) => {
			const shown = await executeStatement(
				db,
				DIFF_COMMENTS_SQL.unhide,
				[now(), id],
				"Bringing back a review comment",
			);
			return shown.ok ? ok(shown.value > 0) : err(shown.error);
		},
		markReviewed: async (ids) => {
			const json = stringifyJson(ids, "diff_comments.ids");
			if (!json.ok) return err(json.error);
			const marked = await executeStatement(
				db,
				DIFF_COMMENTS_SQL.markReviewed,
				[now(), json.value],
				"Marking review comments reviewed",
			);
			return marked.ok ? ok(marked.value) : err(marked.error);
		},
		markReadyForReview: async (workspaceId) => {
			const marked = await executeStatement(
				db,
				DIFF_COMMENTS_SQL.markReadyForReview,
				[now(), workspaceId],
				"Marking review comments ready",
			);
			return marked.ok ? ok(marked.value) : err(marked.error);
		},
		supersedeWorkspace: async (workspaceId) => {
			const superseded = await executeStatement(
				db,
				DIFF_COMMENTS_SQL.supersedeWorkspace,
				[now(), workspaceId],
				"Superseding review comments",
			);
			return superseded.ok ? ok(superseded.value) : err(superseded.error);
		},
		setThreadResolved: (workspaceId, threadId, resolved) =>
			executeVoid(
				db,
				DIFF_COMMENTS_SQL.setThreadResolved,
				[toFlag(resolved), now(), workspaceId, threadId],
				"Resolving a comment thread",
			),
		setOutdated: (id, outdated) =>
			executeExisting(
				db,
				DIFF_COMMENTS_SQL.setOutdated,
				[toFlag(outdated), now(), id],
				"Marking a comment outdated",
			),
		setRemoteUrl: (id, url) =>
			executeExisting(
				db,
				DIFF_COMMENTS_SQL.setRemoteUrl,
				[url, now(), id],
				"Saving a comment link",
			),
		delete: (id) => executeVoid(db, DIFF_COMMENTS_SQL.delete, [id], "Removing a review comment"),
	};
}
