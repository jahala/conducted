/**
 * @feature SIDE-06 Write-ahead event log: write before send, ack, replay
 * Owns: the durable log of events the app has not confirmed yet. An event is appended to the log
 * and made durable first. Only then is it sent. The app confirms with eventPersisted, and the
 * event leaves the log.
 * Behaviour: research/conductor/sessions.md section 5 "Durable event outbox" and the gap noted
 * there: Conductor sends first and backs up on a best-effort basis, so in a burst only the first
 * event per batch is safely backed up. sessions-and-chats.md "Weak spots found" lists the same.
 * Our design choice: a real write-ahead log. append() takes a whole batch, assigns sequence
 * numbers, writes the file atomically and returns only after that. The send path never sends an
 * event that append() did not accept.
 * Must handle:
 *  - sequence numbers strictly increase per chat and survive restarts (nextSequence is in the file)
 *  - a batch is written with one atomic file write, not one write per event
 *  - appends for one chat are serialised; chats do not wait for each other
 *  - acknowledge() removes the event wherever it sits in the pending list (the app stores by
 *    event id, so out-of-order acks are safe); an unknown id is not an error (a replayed ack)
 *  - a failed write: the in-memory pending list is rolled back and the error is returned, so the
 *    caller can retry without sequence gaps
 *  - a corrupt or newer-version file: the chat is blocked with code "outbox_corrupt"; the file is
 *    kept for inspection and never rewritten
 *  - durabilityUncertain after a directory fsync failure: append refuses until a write succeeds
 *  - open() reads every file, drops temp files, and returns the chats that have pending events
 * Data lifetime (what the log keeps, how long, what removes the rest):
 *  - keeps: unacknowledged events, until acknowledged; no age limit, because dropping them loses
 *    chat history
 *  - cap: 20 000 pending events per chat (our choice). Beyond it append() returns
 *    "outbox_full" and the turn ends with a visible error. The app being gone that long is a bug
 *    to see, not to hide
 *  - the file of a chat with no pending events and no activity for 30 days is moved to the Trash
 *    by sweepIdle() at startup. Conductor never removes them
 * Test first: append 3 events, restart (new FileEventOutbox on the same storage); pending() has the
 * same 3 events with sequences 0, 1, 2; acknowledge the middle one; pending() has 0 and 2.
 */
import type { SessionEvent, SessionEventEnvelope } from "@conducted/protocol";
import type { AppError, Clock, EventId, Result, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { KeyedSerialQueue } from "../session/serial-queue.ts";
import type { OutboxStorage } from "./outbox-file.ts";

export const MAX_PENDING_PER_SESSION = 20_000;
export const IDLE_FILE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface EventOutbox {
	/** Reads the log from disk. Returns the chats that have pending events. */
	open(): Promise<Result<SessionId[], AppError>>;
	/** Writes the batch durably and returns the envelopes to send, in order. */
	append(
		sessionId: SessionId,
		events: readonly SessionEvent[],
	): Promise<Result<SessionEventEnvelope[], AppError>>;
	/** The app stored the event. Removes it from the log. */
	acknowledge(sessionId: SessionId, eventId: EventId): Promise<Result<void, AppError>>;
	/** Pending envelopes of a chat, ordered by sequence. */
	pending(sessionId: SessionId): readonly SessionEventEnvelope[];
	/** Chats that have at least one pending event. */
	sessionsWithPending(): SessionId[];
	/** Moves the files of long-idle chats to the Trash. Returns how many. */
	sweepIdle(): Promise<Result<number, AppError>>;
}

export class FileEventOutbox implements EventOutbox {
	constructor(
		protected readonly deps: {
			storage: OutboxStorage;
			queue: KeyedSerialQueue;
			clock: Clock;
			logger: Logger;
		},
	) {}

	open(): Promise<Result<SessionId[], AppError>> {
		return notImplemented("SIDE-06");
	}

	append(
		_sessionId: SessionId,
		_events: readonly SessionEvent[],
	): Promise<Result<SessionEventEnvelope[], AppError>> {
		return notImplemented("SIDE-06");
	}

	acknowledge(_sessionId: SessionId, _eventId: EventId): Promise<Result<void, AppError>> {
		return notImplemented("SIDE-06");
	}

	pending(_sessionId: SessionId): readonly SessionEventEnvelope[] {
		return notImplemented("SIDE-06");
	}

	sessionsWithPending(): SessionId[] {
		return notImplemented("SIDE-06");
	}

	sweepIdle(): Promise<Result<number, AppError>> {
		return notImplemented("SIDE-06");
	}
}
