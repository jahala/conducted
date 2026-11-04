/**
 * @feature DATA-01 Repository for the queued_messages table
 * Owns: follow-up messages typed while the agent works: add, reorder, edit, claim for sending,
 * mark failed, remove.
 * Behaviour: services-map.md 2.3.4 (composer outbox: queue, mark sending or failed, reorder,
 * cancel, steer, pause) and sessions-and-chats.md "While the agent is working".
 * Must handle: positions are 1-based and unique per chat only by convention, so the next
 * position is read and inserted in one transaction; claiming the next waiting row is one
 * statement so two senders never take the same row; rows in `sending` cannot be edited or
 * cancelled; state changes are compare-and-set; a bad attachment_paths column returns an error
 * Result; a sent row is deleted once its user_message event is stored (queue lifetime).
 * Test first: claimNext twice in a row returns two different rows, then nothing.
 */
import { type MessageId, notImplemented, type Result, type SessionId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { QueuedMessage } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import { collectResults, parseStringList, stringifyJson } from "./row-codec.ts";

export interface QueuedMessageRow {
	id: MessageId;
	session_id: SessionId;
	text: string;
	attachment_paths: string;
	delivery: "queue" | "steer";
	position: number;
	state: "waiting" | "sending" | "failed";
	last_error: string | null;
	created_at: number;
	updated_at: number;
}

export function queuedMessageFromRow(row: QueuedMessageRow): Result<QueuedMessage> {
	const paths = parseStringList(row.attachment_paths, "queued_messages.attachment_paths");
	if (!paths.ok) return paths;
	return {
		ok: true,
		value: {
			id: row.id,
			sessionId: row.session_id,
			text: row.text,
			attachmentPaths: paths.value,
			delivery: row.delivery,
			position: row.position,
			state: row.state,
			lastError: row.last_error,
		},
	};
}

/** Maps many rows and stops at the first bad one. */
export const queuedMessagesFromRows = (
	rows: readonly QueuedMessageRow[],
): Result<QueuedMessage[]> => collectResults(rows.map(queuedMessageFromRow));

/** Parameters for QUEUED_MESSAGES_SQL.insert. The row gets `now` as created and updated time. */
export function queuedMessageToParams(
	message: QueuedMessage,
	now: number,
): Result<readonly unknown[]> {
	const paths = stringifyJson(message.attachmentPaths, "queued_messages.attachment_paths");
	if (!paths.ok) return paths;
	return {
		ok: true,
		value: [
			message.id,
			message.sessionId,
			message.text,
			paths.value,
			message.delivery,
			message.position,
			message.state,
			message.lastError,
			now,
			now,
		],
	};
}

const COLUMNS = `id, session_id, text, attachment_paths, delivery, position, state, last_error,
	created_at, updated_at`;

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const QUEUED_MESSAGES_SQL = {
	listBySession: `SELECT ${COLUMNS} FROM queued_messages WHERE session_id = $1
		ORDER BY position, created_at, id`,
	get: `SELECT ${COLUMNS} FROM queued_messages WHERE id = $1`,
	nextPosition: `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM queued_messages
		WHERE session_id = $1`,
	count: "SELECT COUNT(*) AS total FROM queued_messages WHERE session_id = $1",
	insert: `INSERT INTO queued_messages (${COLUMNS})
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
	/** Takes the first waiting row by position and marks it sending, in one statement. */
	claimNext: `UPDATE queued_messages SET state = 'sending', updated_at = $1
		WHERE id = (
			SELECT id FROM queued_messages WHERE session_id = $2 AND state = 'waiting'
			ORDER BY position, created_at, id LIMIT 1)
		RETURNING ${COLUMNS}`,
	setState: `UPDATE queued_messages SET state = $1, last_error = $2, updated_at = $3
		WHERE id = $4 AND state = $5`,
	setContent: `UPDATE queued_messages SET text = $1, attachment_paths = $2, updated_at = $3
		WHERE id = $4 AND state <> 'sending'`,
	setDelivery: `UPDATE queued_messages SET delivery = $1, updated_at = $2
		WHERE id = $3 AND state <> 'sending'`,
	setPosition:
		"UPDATE queued_messages SET position = $1, updated_at = $2 WHERE id = $3 AND session_id = $4",
	delete: "DELETE FROM queued_messages WHERE id = $1",
	deleteUnlessSending: "DELETE FROM queued_messages WHERE id = $1 AND state <> 'sending'",
	deleteBySession: "DELETE FROM queued_messages WHERE session_id = $1",
} as const;

/** What a caller supplies to queue a message. The repository adds position, state and times. */
export type NewQueuedMessage = Pick<
	QueuedMessage,
	"id" | "sessionId" | "text" | "attachmentPaths" | "delivery"
>;

export interface QueuedMessageRepository {
	/** QUEUED_MESSAGES_SQL.listBySession, ordered by position. */
	listBySession(sessionId: SessionId): Promise<Result<QueuedMessage[]>>;
	/** QUEUED_MESSAGES_SQL.get. A missing row is `ok(null)`. */
	get(id: MessageId): Promise<Result<QueuedMessage | null>>;
	/** QUEUED_MESSAGES_SQL.count. */
	count(sessionId: SessionId): Promise<Result<number>>;
	/**
	 * QUEUED_MESSAGES_SQL.nextPosition then QUEUED_MESSAGES_SQL.insert in one transaction, with
	 * state `waiting`.
	 */
	enqueue(input: NewQueuedMessage): Promise<Result<QueuedMessage>>;
	/**
	 * QUEUED_MESSAGES_SQL.claimNext, run with `select` because of RETURNING. `ok(null)` when
	 * nothing is waiting. The caller checks sessions.queue_paused_at before calling.
	 */
	claimNext(sessionId: SessionId): Promise<Result<QueuedMessage | null>>;
	/**
	 * QUEUED_MESSAGES_SQL.setState. Compare-and-set from `from`; `ok(false)` when the row was in
	 * another state. `lastError` is stored with `failed` and cleared otherwise.
	 */
	setState(
		id: MessageId,
		from: QueuedMessage["state"],
		to: QueuedMessage["state"],
		lastError: string | null,
	): Promise<Result<boolean>>;
	/** QUEUED_MESSAGES_SQL.setContent. `ok(false)` when the row is sending or gone. */
	setContent(
		id: MessageId,
		content: { text: string; attachmentPaths: readonly string[] },
	): Promise<Result<boolean>>;
	/** QUEUED_MESSAGES_SQL.setDelivery, for turning a queued message into a steer. */
	setDelivery(id: MessageId, delivery: QueuedMessage["delivery"]): Promise<Result<boolean>>;
	/**
	 * QUEUED_MESSAGES_SQL.setPosition for each id, giving positions 1..n in the given order, in
	 * one transaction.
	 */
	reorder(sessionId: SessionId, orderedIds: readonly MessageId[]): Promise<Result<void>>;
	/** QUEUED_MESSAGES_SQL.deleteUnlessSending, for the user cancelling. `ok(false)` if sending. */
	cancel(id: MessageId): Promise<Result<boolean>>;
	/** QUEUED_MESSAGES_SQL.delete, once the message's user_message event is stored. */
	remove(id: MessageId): Promise<Result<void>>;
	/** QUEUED_MESSAGES_SQL.deleteBySession. */
	clear(sessionId: SessionId): Promise<Result<void>>;
}

export function createQueuedMessageRepository(
	_db: Database,
	_deps: RepositoryDeps,
): QueuedMessageRepository {
	return {
		listBySession: async () => notImplemented("DATA-01"),
		get: async () => notImplemented("DATA-01"),
		count: async () => notImplemented("DATA-01"),
		enqueue: async () => notImplemented("DATA-01"),
		claimNext: async () => notImplemented("DATA-01"),
		setState: async () => notImplemented("DATA-01"),
		setContent: async () => notImplemented("DATA-01"),
		setDelivery: async () => notImplemented("DATA-01"),
		reorder: async () => notImplemented("DATA-01"),
		cancel: async () => notImplemented("DATA-01"),
		remove: async () => notImplemented("DATA-01"),
		clear: async () => notImplemented("DATA-01"),
	};
}
