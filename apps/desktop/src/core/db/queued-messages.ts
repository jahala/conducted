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
import { appError, err, type MessageId, ok, type Result, type SessionId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { QueuedMessage } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	collectResults,
	executeStatement,
	executeVoid,
	inTransaction,
	parseStringList,
	selectRows,
	stringifyJson,
} from "./row-codec.ts";

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
	 * one transaction. The list must name every waiting message of the chat exactly once, so a
	 * partial list cannot leave the other rows with colliding positions; otherwise `db.conflict`.
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
	db: Database,
	deps: RepositoryDeps,
): QueuedMessageRepository {
	const now = (): number => deps.clock.now();
	return {
		listBySession: async (sessionId) => {
			const rows = await selectRows<QueuedMessageRow>(
				db,
				QUEUED_MESSAGES_SQL.listBySession,
				[sessionId],
				"Listing queued messages",
			);
			return rows.ok ? queuedMessagesFromRows(rows.value) : err(rows.error);
		},
		get: async (id) => {
			const rows = await selectRows<QueuedMessageRow>(
				db,
				QUEUED_MESSAGES_SQL.get,
				[id],
				"Reading a queued message",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : queuedMessageFromRow(row);
		},
		count: async (sessionId) => {
			const rows = await selectRows<{ total: number }>(
				db,
				QUEUED_MESSAGES_SQL.count,
				[sessionId],
				"Counting queued messages",
			);
			return rows.ok ? ok(rows.value[0]?.total ?? 0) : err(rows.error);
		},
		enqueue: async (input) =>
			inTransaction(db, "Queuing a message", async (tx) => {
				const next = await selectRows<{ next: number }>(
					tx,
					QUEUED_MESSAGES_SQL.nextPosition,
					[input.sessionId],
					"Reading the next queue position",
				);
				if (!next.ok) return err(next.error);
				const at = now();
				const message: QueuedMessage = {
					id: input.id,
					sessionId: input.sessionId,
					text: input.text,
					attachmentPaths: [...input.attachmentPaths],
					delivery: input.delivery,
					position: next.value[0]?.next ?? 1,
					state: "waiting",
					lastError: null,
				};
				const params = queuedMessageToParams(message, at);
				if (!params.ok) return err(params.error);
				const written = await executeStatement(
					tx,
					QUEUED_MESSAGES_SQL.insert,
					params.value,
					"Queuing a message",
				);
				return written.ok ? ok(message) : err(written.error);
			}),
		claimNext: async (sessionId) => {
			const rows = await selectRows<QueuedMessageRow>(
				db,
				QUEUED_MESSAGES_SQL.claimNext,
				[now(), sessionId],
				"Claiming the next queued message",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : queuedMessageFromRow(row);
		},
		setState: async (id, from, to, lastError) => {
			const written = await executeStatement(
				db,
				QUEUED_MESSAGES_SQL.setState,
				[to, lastError, now(), id, from],
				"Changing a queued message state",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		setContent: async (id, content) => {
			const json = stringifyJson(content.attachmentPaths, "queued_messages.attachment_paths");
			if (!json.ok) return err(json.error);
			const written = await executeStatement(
				db,
				QUEUED_MESSAGES_SQL.setContent,
				[content.text, json.value, now(), id],
				"Editing a queued message",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		setDelivery: async (id, delivery) => {
			const written = await executeStatement(
				db,
				QUEUED_MESSAGES_SQL.setDelivery,
				[delivery, now(), id],
				"Changing a queued message delivery",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		reorder: async (sessionId, orderedIds) =>
			inTransaction(db, "Reordering queued messages", async (tx) => {
				const current = await selectRows<QueuedMessageRow>(
					tx,
					QUEUED_MESSAGES_SQL.listBySession,
					[sessionId],
					"Listing queued messages to reorder",
				);
				if (!current.ok) return err(current.error);
				const waiting = current.value.filter((row) => row.state === "waiting").map((row) => row.id);
				const given = new Set(orderedIds);
				if (
					given.size !== orderedIds.length ||
					given.size !== waiting.length ||
					!waiting.every((id) => given.has(id))
				) {
					return err(
						appError(
							"db.conflict",
							"Reordering a queue needs every waiting message of that chat, each once.",
						),
					);
				}
				const at = now();
				for (const [index, id] of orderedIds.entries()) {
					const written = await executeStatement(
						tx,
						QUEUED_MESSAGES_SQL.setPosition,
						[index + 1, at, id, sessionId],
						"Reordering queued messages",
					);
					if (!written.ok) return err(written.error);
				}
				return ok(undefined);
			}),
		cancel: async (id) => {
			const written = await executeStatement(
				db,
				QUEUED_MESSAGES_SQL.deleteUnlessSending,
				[id],
				"Cancelling a queued message",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		remove: (id) => executeVoid(db, QUEUED_MESSAGES_SQL.delete, [id], "Removing a queued message"),
		clear: (sessionId) =>
			executeVoid(db, QUEUED_MESSAGES_SQL.deleteBySession, [sessionId], "Clearing the queue"),
	};
}
