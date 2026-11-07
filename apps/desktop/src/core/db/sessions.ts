/**
 * @feature DATA-01 Repository for the sessions table
 * Owns: every read and write of the sessions table (one row per chat, without its events).
 * Behaviour: services-map.md 2.3.3 (sessions) and sessions-and-chats.md "How chats are stored".
 * Live status is not here: it lives in session_live_state.
 * Must handle: a bad config column returns an error Result; unread counts change in SQL
 * (`unread_count + 1`) so two writers never lose an increment; last_user_message_at and the
 * updated_at it sets only move forward; a title, config, agent session id or reopen on a missing chat
 * returns `db.not_found`; setTitleIfEmpty never overwrites a title the user set; pausing is idempotent.
 * Test first: sessionFromRow returns an error Result when config is not a valid SessionConfig.
 */
import { zSessionConfig } from "@conducted/protocol";
import { err, ok, type Result, type SessionId, type WorkspaceId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Session } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	collectResults,
	executeExisting,
	executeStatement,
	executeVoid,
	inTransaction,
	parseJsonColumn,
	selectRows,
	stringifyJson,
} from "./row-codec.ts";

export interface SessionRow {
	id: SessionId;
	workspace_id: WorkspaceId;
	title: string | null;
	config: string;
	agent_session_id: string | null;
	unread_count: number;
	context_used_tokens: number | null;
	queue_paused_at: number | null;
	closed_at: number | null;
	last_user_message_at: number | null;
	created_at: number;
	updated_at: number;
	fork_resume_native_message_id: string | null;
}

export function sessionFromRow(row: SessionRow): Result<Session> {
	const config = parseJsonColumn(row.config, zSessionConfig, "sessions.config");
	if (!config.ok) return config;
	return {
		ok: true,
		value: {
			id: row.id,
			workspaceId: row.workspace_id,
			title: row.title,
			config: config.value,
			agentSessionId: row.agent_session_id,
			unreadCount: row.unread_count,
			contextUsedTokens: row.context_used_tokens,
			queuePausedAt: row.queue_paused_at,
			closedAt: row.closed_at,
			lastUserMessageAt: row.last_user_message_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			forkResumeNativeMessageId: row.fork_resume_native_message_id,
		},
	};
}

/**
 * The sessions table's columns, in the order every statement names them. The array is the one
 * home for the column list: the SELECT, the INSERT placeholders and the tests all use it, so a
 * dropped column (migration 0013 dropped context_window_tokens) cannot leave a positional list
 * out of step.
 */
export const SESSION_COLUMNS = [
	"id",
	"workspace_id",
	"title",
	"config",
	"agent_session_id",
	"unread_count",
	"context_used_tokens",
	"queue_paused_at",
	"closed_at",
	"last_user_message_at",
	"created_at",
	"updated_at",
	"fork_resume_native_message_id",
] as const;

type SessionColumn = (typeof SESSION_COLUMNS)[number];

/** Parameters for SESSIONS_SQL.insert, in `SESSION_COLUMNS` order. */
export function sessionToParams(session: Session): Result<readonly unknown[]> {
	const config = stringifyJson(session.config, "sessions.config");
	if (!config.ok) return config;
	// The values are named first, so a column added or removed from SESSION_COLUMNS is a type error
	// here rather than a value landing in the wrong column.
	const values: Record<SessionColumn, unknown> = {
		id: session.id,
		workspace_id: session.workspaceId,
		title: session.title,
		config: config.value,
		agent_session_id: session.agentSessionId,
		unread_count: session.unreadCount,
		context_used_tokens: session.contextUsedTokens,
		queue_paused_at: session.queuePausedAt,
		closed_at: session.closedAt,
		last_user_message_at: session.lastUserMessageAt,
		created_at: session.createdAt,
		updated_at: session.updatedAt,
		fork_resume_native_message_id: session.forkResumeNativeMessageId,
	};
	return { ok: true, value: SESSION_COLUMNS.map((column) => values[column]) };
}

const COLUMNS = SESSION_COLUMNS.join(", ");

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const SESSIONS_SQL = {
	listByWorkspace: `SELECT ${COLUMNS} FROM sessions WHERE workspace_id = $1
		ORDER BY created_at, id`,
	listOpenByWorkspace: `SELECT ${COLUMNS} FROM sessions WHERE workspace_id = $1
		AND closed_at IS NULL ORDER BY created_at, id`,
	get: `SELECT ${COLUMNS} FROM sessions WHERE id = $1`,
	insert: `INSERT INTO sessions (${COLUMNS})
		VALUES (${SESSION_COLUMNS.map((_, index) => `$${index + 1}`).join(", ")})`,
	setTitle: "UPDATE sessions SET title = $1, updated_at = $2 WHERE id = $3",
	setTitleIfEmpty:
		"UPDATE sessions SET title = $1, updated_at = $2 WHERE id = $3 AND title IS NULL",
	setConfig: "UPDATE sessions SET config = $1, updated_at = $2 WHERE id = $3",
	setAgentSessionId: "UPDATE sessions SET agent_session_id = $1, updated_at = $2 WHERE id = $3",
	setForkResume: `UPDATE sessions SET fork_resume_native_message_id = $1, updated_at = $2
		WHERE id = $3`,
	setContextUsage: "UPDATE sessions SET context_used_tokens = $1 WHERE id = $2",
	/**
	 * A user message reached the agent. A fork's resume point is used up by its first one, so it is
	 * cleared in the same statement (CHAT-16).
	 */
	recordUserMessage: `UPDATE sessions SET last_user_message_at =
		MAX(COALESCE(last_user_message_at, 0), $1), updated_at = MAX(updated_at, $1),
		fork_resume_native_message_id = NULL WHERE id = $2`,
	incrementUnread: "UPDATE sessions SET unread_count = unread_count + 1 WHERE id = $1",
	clearUnread: "UPDATE sessions SET unread_count = 0 WHERE id = $1 AND unread_count > 0",
	pauseQueue: "UPDATE sessions SET queue_paused_at = $1 WHERE id = $2 AND queue_paused_at IS NULL",
	resumeQueue: "UPDATE sessions SET queue_paused_at = NULL WHERE id = $1",
	close: "UPDATE sessions SET closed_at = $1, updated_at = $1 WHERE id = $2 AND closed_at IS NULL",
	reopen: "UPDATE sessions SET closed_at = NULL, updated_at = $1 WHERE id = $2",
	delete: "DELETE FROM sessions WHERE id = $1",
} as const;

/** What a caller supplies to add a chat. The repository adds id, counters and times. */
export type NewSession = Pick<Session, "workspaceId" | "title" | "config">;

export interface SessionRepository {
	/** SESSIONS_SQL.listByWorkspace, or listOpenByWorkspace when `includeClosed` is false. */
	listByWorkspace(
		workspaceId: WorkspaceId,
		options: { includeClosed: boolean },
	): Promise<Result<Session[]>>;
	/** SESSIONS_SQL.get. A missing chat is `ok(null)`. */
	get(id: SessionId): Promise<Result<Session | null>>;
	/** SESSIONS_SQL.insert with zero unread and no agent session id. */
	create(input: NewSession): Promise<Result<Session>>;
	/** SESSIONS_SQL.setTitle. */
	setTitle(id: SessionId, title: string | null): Promise<Result<void>>;
	/** SESSIONS_SQL.setTitleIfEmpty. `ok(false)` when the chat already has a title. */
	setTitleIfEmpty(id: SessionId, title: string): Promise<Result<boolean>>;
	/** SESSIONS_SQL.setConfig. Writes the config as JSON. */
	setConfig(id: SessionId, config: Session["config"]): Promise<Result<void>>;
	/** SESSIONS_SQL.setAgentSessionId, kept so the next turn can resume. */
	setAgentSessionId(id: SessionId, agentSessionId: string | null): Promise<Result<void>>;
	/** SESSIONS_SQL.setForkResume: where a forked chat's first send resumes its agent. */
	setForkResume(id: SessionId, nativeMessageId: string | null): Promise<Result<void>>;
	/** SESSIONS_SQL.setContextUsage. Does not touch updated_at. */
	setContextUsage(id: SessionId, usage: { usedTokens: number | null }): Promise<Result<void>>;
	/** SESSIONS_SQL.recordUserMessage. Moves last_user_message_at forward only. */
	recordUserMessage(id: SessionId, at: number): Promise<Result<void>>;
	/** SESSIONS_SQL.incrementUnread. The addition happens in SQL, not in TypeScript. */
	incrementUnread(id: SessionId): Promise<Result<void>>;
	/** SESSIONS_SQL.clearUnread. */
	clearUnread(id: SessionId): Promise<Result<void>>;
	/** SESSIONS_SQL.pauseQueue. Does nothing when already paused. */
	pauseQueue(id: SessionId, at: number): Promise<Result<void>>;
	/** SESSIONS_SQL.resumeQueue. */
	resumeQueue(id: SessionId): Promise<Result<void>>;
	/** SESSIONS_SQL.close. The chat stays in history. `ok(false)` when it was already closed. */
	close(id: SessionId): Promise<Result<boolean>>;
	/** SESSIONS_SQL.reopen. */
	reopen(id: SessionId): Promise<Result<void>>;
	/** SESSIONS_SQL.delete. The database cascades to events, live state, queue and attachments. */
	delete(id: SessionId): Promise<Result<void>>;
}

export function createSessionRepository(db: Database, deps: RepositoryDeps): SessionRepository {
	const now = (): number => deps.clock.now();
	return {
		listByWorkspace: async (workspaceId, options) => {
			const rows = await selectRows<SessionRow>(
				db,
				options.includeClosed ? SESSIONS_SQL.listByWorkspace : SESSIONS_SQL.listOpenByWorkspace,
				[workspaceId],
				"Listing chats",
			);
			return rows.ok ? collectResults(rows.value.map(sessionFromRow)) : err(rows.error);
		},
		get: async (id) => {
			const rows = await selectRows<SessionRow>(db, SESSIONS_SQL.get, [id], "Reading a chat");
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : sessionFromRow(row);
		},
		create: async (input) =>
			inTransaction(db, "Creating a chat", async (tx) => {
				const at = now();
				const session: Session = {
					id: deps.ids.uuid() as SessionId,
					workspaceId: input.workspaceId,
					title: input.title,
					config: input.config,
					agentSessionId: null,
					forkResumeNativeMessageId: null,
					unreadCount: 0,
					contextUsedTokens: null,
					queuePausedAt: null,
					closedAt: null,
					lastUserMessageAt: null,
					createdAt: at,
					updatedAt: at,
				};
				const params = sessionToParams(session);
				if (!params.ok) return err(params.error);
				const written = await executeStatement(
					tx,
					SESSIONS_SQL.insert,
					params.value,
					"Creating a chat",
				);
				return written.ok ? ok(session) : err(written.error);
			}),
		setTitle: (id, title) =>
			executeExisting(db, SESSIONS_SQL.setTitle, [title, now(), id], "Titling a chat"),
		setTitleIfEmpty: async (id, title) => {
			const written = await executeStatement(
				db,
				SESSIONS_SQL.setTitleIfEmpty,
				[title, now(), id],
				"Titling a chat",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		setConfig: async (id, config) => {
			const json = stringifyJson(config, "sessions.config");
			if (!json.ok) return err(json.error);
			return executeExisting(
				db,
				SESSIONS_SQL.setConfig,
				[json.value, now(), id],
				"Saving a chat config",
			);
		},
		setAgentSessionId: (id, agentSessionId) =>
			executeExisting(
				db,
				SESSIONS_SQL.setAgentSessionId,
				[agentSessionId, now(), id],
				"Saving an agent session id",
			),
		setForkResume: (id, nativeMessageId) =>
			executeExisting(
				db,
				SESSIONS_SQL.setForkResume,
				[nativeMessageId, now(), id],
				"Saving where a forked chat resumes",
			),
		setContextUsage: (id, usage) =>
			executeVoid(db, SESSIONS_SQL.setContextUsage, [usage.usedTokens, id], "Saving context usage"),
		recordUserMessage: (id, at) =>
			executeVoid(db, SESSIONS_SQL.recordUserMessage, [at, id], "Recording a user message"),
		incrementUnread: (id) =>
			executeVoid(db, SESSIONS_SQL.incrementUnread, [id], "Marking a chat unread"),
		clearUnread: (id) => executeVoid(db, SESSIONS_SQL.clearUnread, [id], "Marking a chat read"),
		pauseQueue: (id, at) =>
			executeVoid(db, SESSIONS_SQL.pauseQueue, [at, id], "Pausing the follow-up queue"),
		resumeQueue: (id) =>
			executeVoid(db, SESSIONS_SQL.resumeQueue, [id], "Resuming the follow-up queue"),
		close: async (id) => {
			const written = await executeStatement(db, SESSIONS_SQL.close, [now(), id], "Closing a chat");
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		reopen: (id) => executeExisting(db, SESSIONS_SQL.reopen, [now(), id], "Reopening a chat"),
		delete: (id) => executeVoid(db, SESSIONS_SQL.delete, [id], "Removing a chat"),
	};
}
