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
import { hostFromRow, workspaceHostExpressions } from "./host-rows.ts";
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
	host_kind: "local" | "cloud";
	host_url: string | null;
	host_vm_id: string | null;
	title: string | null;
	config: string;
	agent_session_id: string | null;
	unread_count: number;
	context_used_tokens: number | null;
	context_window_tokens: number | null;
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
	const host = hostFromRow(row);
	if (!host.ok) return host;
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
			contextWindowTokens: row.context_window_tokens,
			queuePausedAt: row.queue_paused_at,
			closedAt: row.closed_at,
			lastUserMessageAt: row.last_user_message_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			forkResumeNativeMessageId: row.fork_resume_native_message_id,
		},
	};
}

/** Parameters for SESSIONS_SQL.insert. The host columns come from the workspace, so they are not here. */
export function sessionToParams(session: Session): Result<readonly unknown[]> {
	const config = stringifyJson(session.config, "sessions.config");
	if (!config.ok) return config;
	return {
		ok: true,
		value: [
			session.id,
			session.workspaceId,
			session.title,
			config.value,
			session.agentSessionId,
			session.unreadCount,
			session.contextUsedTokens,
			session.contextWindowTokens,
			session.queuePausedAt,
			session.closedAt,
			session.lastUserMessageAt,
			session.createdAt,
			session.updatedAt,
			session.forkResumeNativeMessageId,
		],
	};
}

const COLUMNS = `id, workspace_id, host_kind, host_url, host_vm_id, title, config,
	agent_session_id, unread_count, context_used_tokens, context_window_tokens, queue_paused_at,
	closed_at, last_user_message_at, created_at, updated_at, fork_resume_native_message_id`;

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const SESSIONS_SQL = {
	listByWorkspace: `SELECT ${COLUMNS} FROM sessions WHERE workspace_id = $1
		ORDER BY created_at, id`,
	listOpenByWorkspace: `SELECT ${COLUMNS} FROM sessions WHERE workspace_id = $1
		AND closed_at IS NULL ORDER BY created_at, id`,
	get: `SELECT ${COLUMNS} FROM sessions WHERE id = $1`,
	/**
	 * The host is copied from the workspace, never passed in, so no caller can store a chat under
	 * a host its workspace does not have (CLOUD-13). Parameter list unchanged: `sessionToParams`
	 * still supplies id, workspace and the rest.
	 */
	insert: `INSERT INTO sessions (id, workspace_id, host_kind, host_url, host_vm_id, title, config,
		agent_session_id, unread_count, context_used_tokens, context_window_tokens, queue_paused_at,
		closed_at, last_user_message_at, created_at, updated_at, fork_resume_native_message_id)
		VALUES ($1, $2, ${workspaceHostExpressions(2)}, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
			$13, $14)`,
	setTitle: "UPDATE sessions SET title = $1, updated_at = $2 WHERE id = $3",
	setTitleIfEmpty:
		"UPDATE sessions SET title = $1, updated_at = $2 WHERE id = $3 AND title IS NULL",
	setConfig: "UPDATE sessions SET config = $1, updated_at = $2 WHERE id = $3",
	setAgentSessionId: "UPDATE sessions SET agent_session_id = $1, updated_at = $2 WHERE id = $3",
	setForkResume: `UPDATE sessions SET fork_resume_native_message_id = $1, updated_at = $2
		WHERE id = $3`,
	setContextUsage: `UPDATE sessions SET context_used_tokens = $1, context_window_tokens = $2
		WHERE id = $3`,
	/**
	 * A user message reached the agent. A fork's resume point is used up by its first one, so it is
	 * cleared in the same statement (CHAT-16).
	 */
	recordUserMessage: `UPDATE sessions SET last_user_message_at =
		MAX(COALESCE(last_user_message_at, 0), $1), updated_at = MAX(updated_at, $1),
		fork_resume_native_message_id = NULL WHERE id = $2`,
	incrementUnread: "UPDATE sessions SET unread_count = unread_count + 1 WHERE id = $1",
	clearUnread: "UPDATE sessions SET unread_count = 0 WHERE id = $1 AND unread_count > 0",
	clearWorkspaceUnread: `UPDATE sessions SET unread_count = 0
		WHERE workspace_id = $1 AND unread_count > 0 RETURNING id`,
	unreadByWorkspace: `SELECT workspace_id, SUM(unread_count) AS unread FROM sessions
		WHERE unread_count > 0 GROUP BY workspace_id`,
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
	setContextUsage(
		id: SessionId,
		usage: { usedTokens: number | null; windowTokens: number | null },
	): Promise<Result<void>>;
	/** SESSIONS_SQL.recordUserMessage. Moves last_user_message_at forward only. */
	recordUserMessage(id: SessionId, at: number): Promise<Result<void>>;
	/** SESSIONS_SQL.incrementUnread. The addition happens in SQL, not in TypeScript. */
	incrementUnread(id: SessionId): Promise<Result<void>>;
	/** SESSIONS_SQL.clearUnread. */
	clearUnread(id: SessionId): Promise<Result<void>>;
	/** SESSIONS_SQL.clearWorkspaceUnread. Returns the ids of the chats that changed. */
	clearWorkspaceUnread(workspaceId: WorkspaceId): Promise<Result<SessionId[]>>;
	/** SESSIONS_SQL.unreadByWorkspace, for the sidebar badges. */
	unreadByWorkspace(): Promise<Result<{ workspaceId: WorkspaceId; unread: number }[]>>;
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
					contextWindowTokens: null,
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
			executeVoid(
				db,
				SESSIONS_SQL.setContextUsage,
				[usage.usedTokens, usage.windowTokens, id],
				"Saving context usage",
			),
		recordUserMessage: (id, at) =>
			executeVoid(db, SESSIONS_SQL.recordUserMessage, [at, id], "Recording a user message"),
		incrementUnread: (id) =>
			executeVoid(db, SESSIONS_SQL.incrementUnread, [id], "Marking a chat unread"),
		clearUnread: (id) => executeVoid(db, SESSIONS_SQL.clearUnread, [id], "Marking a chat read"),
		clearWorkspaceUnread: async (workspaceId) => {
			const rows = await selectRows<{ id: SessionId }>(
				db,
				SESSIONS_SQL.clearWorkspaceUnread,
				[workspaceId],
				"Marking a workspace read",
			);
			return rows.ok ? ok(rows.value.map((row) => row.id)) : err(rows.error);
		},
		unreadByWorkspace: async () => {
			const rows = await selectRows<{ workspace_id: WorkspaceId; unread: number }>(
				db,
				SESSIONS_SQL.unreadByWorkspace,
				[],
				"Reading unread counts",
			);
			return rows.ok
				? ok(rows.value.map((row) => ({ workspaceId: row.workspace_id, unread: row.unread })))
				: err(rows.error);
		},
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
