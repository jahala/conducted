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
 *  - a corrupt or newer-version file: the sidecar refuses to start with code "outbox_corrupt"; the
 *    file is kept for inspection and never rewritten
 *  - durabilityUncertain after a directory fsync failure: append refuses with
 *    "outbox_durability_uncertain" until a new process opens the log or an acknowledgement writes
 *    the file again (that write also syncs the directory). An ordinary write failure rolls back
 *    and does not mark the chat; durabilityUncertain() shows the flag to callers
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
import type { AppError, Clock, EventId, KeyedQueue, Result, SessionId } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import {
	fileNameFor,
	OUTBOX_FILE_VERSION,
	type OutboxEntry,
	type OutboxFile,
	type OutboxStorage,
	sessionIdFromFileName,
	zOutboxFile,
} from "./outbox-file.ts";

/**
 * The queue key of a chat's outbox work. The session manager keys the same queue by the bare
 * session id and waits for a flush inside its job, so sharing that key would deadlock.
 */
function outboxQueueKey(sessionId: SessionId): string {
	return `outbox:${sessionId}`;
}

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
	/**
	 * True when a directory fsync failed and append refuses. Optional on the port: a stand-in that
	 * never reports the condition has nothing to expose; the real outbox always implements it.
	 */
	durabilityUncertain?(sessionId: SessionId): boolean;
}

interface ChatState {
	sessionId: SessionId;
	nextSequence: number;
	pending: OutboxEntry[];
	updatedAt: number;
	durabilityUncertain: boolean;
}

export class FileEventOutbox implements EventOutbox {
	private states = new Map<SessionId, ChatState>();

	constructor(
		protected readonly deps: {
			storage: OutboxStorage;
			queue: KeyedQueue;
			clock: Clock;
			logger: Logger;
		},
	) {}

	async open(): Promise<Result<SessionId[], AppError>> {
		this.states = new Map();
		const cleaned = await this.deps.storage.cleanTempFiles();
		if (!cleaned.ok) return err(cleaned.error);
		const listed = await this.deps.storage.list();
		if (!listed.ok) return err(listed.error);
		for (const fileName of listed.value) {
			const sessionId = sessionIdFromFileName(fileName);
			if (sessionId === null) continue;
			const text = await this.deps.storage.read(fileName);
			if (!text.ok) return err(text.error);
			if (text.value === null) continue;
			const loaded = this.parseFile(fileName, sessionId, text.value);
			if (!loaded.ok) return err(loaded.error);
			this.states.set(loaded.value.sessionId as SessionId, loaded.value);
		}
		return ok(this.sessionsWithPending());
	}

	async append(
		sessionId: SessionId,
		events: readonly SessionEvent[],
	): Promise<Result<SessionEventEnvelope[], AppError>> {
		if (events.length === 0) return ok([]);
		return this.deps.queue.run(outboxQueueKey(sessionId), async () => {
			const current = this.states.get(sessionId);
			const base: ChatState = current ?? {
				sessionId,
				nextSequence: 0,
				pending: [],
				updatedAt: 0,
				durabilityUncertain: false,
			};
			if (base.durabilityUncertain) {
				return err(
					appError(
						"outbox_durability_uncertain",
						"The event log for this chat is not durable after a directory fsync failure. Restart the sidecar or let the app acknowledge a pending event before adding more.",
					),
				);
			}
			if (base.pending.length + events.length > MAX_PENDING_PER_SESSION) {
				return err(
					appError(
						"outbox_full",
						`The event log for this chat holds its limit of ${MAX_PENDING_PER_SESSION} unconfirmed events. The app has not confirmed events for too long.`,
					),
				);
			}
			const at = this.deps.clock.now();
			const entries: OutboxEntry[] = events.map((event, index) => ({
				eventId: event.eventId,
				sequence: base.nextSequence + index,
				event,
				persistedAt: at,
			}));
			const next: ChatState = {
				sessionId,
				nextSequence: base.nextSequence + entries.length,
				pending: [...base.pending, ...entries],
				updatedAt: at,
				durabilityUncertain: false,
			};
			const written = await this.writeFile(next);
			if (!written.ok) {
				// Only a directory fsync failure leaves the rename unconfirmed. Keep the state even
				// for a chat that has none yet, so the flag has somewhere to live and append refuses.
				if (written.error.code === "outbox_dir_sync_failed") {
					this.states.set(sessionId, { ...base, updatedAt: at, durabilityUncertain: true });
					this.deps.logger.warn("The event log write failed; this chat's durability is uncertain", {
						sessionId,
						reason: written.error.message,
					});
				}
				return err(written.error);
			}
			this.states.set(sessionId, next);
			return ok(
				entries.map((entry) => ({
					sessionId,
					sequence: entry.sequence,
					event: entry.event,
				})),
			);
		});
	}

	async acknowledge(sessionId: SessionId, eventId: EventId): Promise<Result<void, AppError>> {
		return this.deps.queue.run(outboxQueueKey(sessionId), async () => {
			const current = this.states.get(sessionId);
			if (current === undefined) return ok(undefined);
			const index = current.pending.findIndex((entry) => entry.eventId === eventId);
			// An unknown id is a replayed acknowledgement, not an error.
			if (index < 0) return ok(undefined);
			const next: ChatState = {
				sessionId,
				nextSequence: current.nextSequence,
				pending: [...current.pending.slice(0, index), ...current.pending.slice(index + 1)],
				updatedAt: this.deps.clock.now(),
				durabilityUncertain: false,
			};
			const written = await this.writeFile(next);
			if (!written.ok) {
				if (written.error.code === "outbox_dir_sync_failed") {
					this.states.set(sessionId, { ...current, durabilityUncertain: true });
					this.deps.logger.warn("The event log write failed; this chat's durability is uncertain", {
						sessionId,
						reason: written.error.message,
					});
				}
				return err(written.error);
			}
			if (current.durabilityUncertain) {
				this.deps.logger.info("The event log is durable again", { sessionId });
			}
			this.states.set(sessionId, next);
			return ok(undefined);
		});
	}

	pending(sessionId: SessionId): readonly SessionEventEnvelope[] {
		const state = this.states.get(sessionId);
		if (state === undefined) return [];
		return state.pending.map((entry) => ({
			sessionId,
			sequence: entry.sequence,
			event: entry.event,
		}));
	}

	sessionsWithPending(): SessionId[] {
		const sessions: SessionId[] = [];
		for (const state of this.states.values()) {
			if (state.pending.length > 0) sessions.push(state.sessionId);
		}
		return sessions;
	}

	durabilityUncertain(sessionId: SessionId): boolean {
		return this.states.get(sessionId)?.durabilityUncertain ?? false;
	}

	async sweepIdle(): Promise<Result<number, AppError>> {
		const now = this.deps.clock.now();
		let moved = 0;
		for (const sessionId of [...this.states.keys()]) {
			// The check and the Trash move share the chat's queue, so an append either lands
			// before the check (and keeps the file) or after the move (and starts a new file).
			const outcome = await this.deps.queue.run(
				outboxQueueKey(sessionId),
				async (): Promise<Result<boolean, AppError>> => {
					const state = this.states.get(sessionId);
					if (state === undefined) return ok(false);
					if (state.pending.length > 0) return ok(false);
					if (now - state.updatedAt <= IDLE_FILE_RETENTION_MS) return ok(false);
					const removed = await this.deps.storage.moveToTrash(fileNameFor(sessionId));
					if (!removed.ok) return err(removed.error);
					this.states.delete(sessionId);
					return ok(true);
				},
			);
			if (!outcome.ok) return err(outcome.error);
			if (outcome.value) moved += 1;
		}
		return ok(moved);
	}

	private async writeFile(state: ChatState): Promise<Result<void, AppError>> {
		const file: OutboxFile = {
			version: OUTBOX_FILE_VERSION,
			sessionId: state.sessionId,
			nextSequence: state.nextSequence,
			pending: state.pending,
			updatedAt: state.updatedAt,
		};
		return this.deps.storage.writeAtomic(fileNameFor(state.sessionId), JSON.stringify(file));
	}

	private parseFile(
		fileName: string,
		sessionId: string,
		text: string,
	): Result<ChatState, AppError> {
		const corrupt = (reason: string): Result<ChatState, AppError> =>
			err(
				appError(
					"outbox_corrupt",
					`The event log ${fileName} is unreadable (${reason}). It was kept for inspection.`,
				),
			);
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			return corrupt("not JSON");
		}
		const parsed = zOutboxFile.safeParse(raw);
		if (!parsed.success) {
			const version =
				typeof raw === "object" && raw !== null && "version" in raw
					? (raw as { version?: unknown }).version
					: undefined;
			if (typeof version === "number" && version > OUTBOX_FILE_VERSION) {
				return corrupt(`version ${version} is newer than this app`);
			}
			return corrupt("wrong shape");
		}
		if (parsed.data.sessionId !== sessionId) {
			return corrupt("the file name and the session id disagree");
		}
		let previous = -1;
		for (const entry of parsed.data.pending) {
			if (entry.eventId !== entry.event.eventId) {
				return corrupt("an entry's event id disagrees with its event");
			}
			if (entry.sequence <= previous) {
				return corrupt("the sequence numbers are not strictly increasing");
			}
			if (entry.sequence >= parsed.data.nextSequence) {
				return corrupt("an entry's sequence is beyond nextSequence");
			}
			previous = entry.sequence;
		}
		return ok({
			sessionId: parsed.data.sessionId as SessionId,
			nextSequence: parsed.data.nextSequence,
			pending: [...parsed.data.pending],
			updatedAt: parsed.data.updatedAt,
			durabilityUncertain: false,
		});
	}
}
