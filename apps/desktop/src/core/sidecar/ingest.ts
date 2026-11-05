/**
 * @feature DATA-04 Event ingest: store each event in order, then acknowledge
 * Owns: taking one `SessionEventEnvelope` from the sidecar, writing it to `session_events`,
 * applying its effects to the chat's stored columns and in-memory state, and only then sending
 * `eventPersisted` back.
 * Behaviour: sessions-and-chats.md "What happens when you send a message" steps 7 and 8,
 * sessions.md 5 (pipeline and durable outbox), frontend.md 3c (inbound path: per-session serial
 * queue, then the acknowledgement).
 * Must handle: events of one chat are handled one at a time in arrival order (a serial queue per
 * session, other chats run in parallel); a duplicate event id inserts nothing and is
 * acknowledged again (replay is at least once); the acknowledgement is sent only after the write
 * is committed, and never when the write failed (the sidecar then resends); a gap in
 * `sequence` is not an error (replay will fill it, ingest never reorders); an event for a chat
 * that no longer exists is acknowledged and dropped, so the sidecar does not resend it forever;
 * `turn_ended` clears the turn's open interaction; a `usage` item updates the chat's context
 * columns; a `user_message` sets `last_user_message_at`; an agent event in a chat the user is not
 * looking at raises the unread flag.
 * Our design choice: one transaction per event covers the event row and the chat columns it
 * changes, and a partial write is rolled back before the acknowledgement is withheld. The
 * in-memory store is updated after the commit, so a failed write never shows.
 * Test first: ingesting the same envelope twice stores one row and sends two acknowledgements.
 */
import type { AgentMessage, SessionEvent, SessionEventEnvelope } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result, type SessionId } from "@conducted/shared";
import { createKeyedQueue } from "../async/serial-queue.ts";
import type { Repositories } from "../db/repositories.ts";
import type { Session } from "../model.ts";
import type { SidecarClient } from "./tunnel.ts";

export interface IngestOutcome {
	/** False when the event was a duplicate or was dropped; true when a new row was written. */
	stored: boolean;
	/** The position of the stored event in the chat, when it was stored. */
	idx: number | null;
}

/** Called after the commit so stores can show the event. Must not throw. */
export interface IngestListener {
	onStored(sessionId: SessionId, envelope: SessionEventEnvelope, idx: number): void;
	/** Whether the user is looking at this chat in a focused window (decides the unread flag). */
	isViewing(sessionId: SessionId): boolean;
}

export interface EventIngestDeps {
	repositories: () => Repositories;
	runInTransaction: <T>(work: (repos: Repositories) => Promise<T>) => Promise<T>;
	sidecar: Pick<SidecarClient, "notify">;
	listener: IngestListener;
	log: (level: "warn" | "error", message: string, data?: unknown) => void;
}

/** Thrown inside the transaction so the database rolls back before the caller is told. */
class IngestFailure extends Error {
	readonly error: AppError;

	constructor(error: AppError) {
		super(error.message);
		this.error = error;
	}
}

/** The last usage item of an agent message, which carries the chat's context figures. */
function lastUsage(
	items: AgentMessage["items"],
): Extract<AgentMessage["items"][number], { kind: "usage" }> | null {
	let usage: Extract<AgentMessage["items"][number], { kind: "usage" }> | null = null;
	for (const item of items) {
		if (item.kind === "usage") usage = item;
	}
	return usage;
}

/** Applies the stored columns an event changes. Reads happen before the caller commits. */
async function applyEffects(
	repos: Repositories,
	session: Session,
	event: SessionEvent,
	viewing: boolean,
): Promise<Result<void>> {
	switch (event.type) {
		case "user_message":
			return repos.sessions.recordUserMessage(session.id, event.at);
		case "agent": {
			const usage = lastUsage(event.message.items);
			if (
				usage !== null &&
				(usage.contextUsedTokens !== undefined || usage.contextWindowTokens !== undefined)
			) {
				const written = await repos.sessions.setContextUsage(session.id, {
					usedTokens: usage.contextUsedTokens ?? session.contextUsedTokens,
					windowTokens: usage.contextWindowTokens ?? session.contextWindowTokens,
				});
				if (!written.ok) return written;
			}
			if (!viewing && session.unreadCount === 0) return repos.sessions.incrementUnread(session.id);
			return ok(undefined);
		}
		case "checkpoint":
		case "turn_ended":
			return ok(undefined);
	}
}

export class EventIngest {
	readonly #deps: EventIngestDeps;
	readonly #queue = createKeyedQueue<SessionId>();
	readonly #pending = new Set<Promise<unknown>>();

	constructor(deps: EventIngestDeps) {
		this.#deps = deps;
	}

	/** Handles one envelope. Resolves after the acknowledgement was sent or deliberately withheld. */
	ingest(envelope: SessionEventEnvelope): Promise<Result<IngestOutcome>> {
		const task = this.#queue.run(envelope.sessionId, () => this.#store(envelope));
		this.#pending.add(task);
		const clear = (): void => {
			this.#pending.delete(task);
		};
		void task.then(clear, clear);
		return task;
	}

	/** Waits until every queued event of every chat has been handled. Used by tests and shutdown. */
	async idle(): Promise<void> {
		while (this.#pending.size > 0) {
			await Promise.allSettled([...this.#pending]);
		}
	}

	async #store(envelope: SessionEventEnvelope): Promise<Result<IngestOutcome>> {
		const { sessionId } = envelope;
		try {
			const outcome = await this.#deps.runInTransaction(async (repos): Promise<IngestOutcome> => {
				const session = await repos.sessions.get(sessionId);
				if (!session.ok) throw new IngestFailure(session.error);
				// The chat is gone. Writing would fail the foreign key, and replay would retry forever.
				if (session.value === null) return { stored: false, idx: null };

				const appended = await repos.sessionEvents.append(
					sessionId,
					envelope.event,
					envelope.event.at,
				);
				if (!appended.ok) throw new IngestFailure(appended.error);
				if (appended.value.kind === "duplicate") return { stored: false, idx: null };

				const effects = await applyEffects(
					repos,
					session.value,
					envelope.event,
					this.#deps.listener.isViewing(sessionId),
				);
				if (!effects.ok) throw new IngestFailure(effects.error);
				return { stored: true, idx: appended.value.idx };
			});

			if (outcome.stored && outcome.idx !== null) {
				this.#show(sessionId, envelope, outcome.idx);
			}
			await this.#acknowledge(sessionId, envelope.event.eventId);
			return ok(outcome);
		} catch (cause) {
			const error =
				cause instanceof IngestFailure
					? cause.error
					: appError("db.failed", "Storing a chat event failed", cause);
			this.#deps.log("error", "Storing a chat event failed", error);
			return err(error);
		}
	}

	#show(sessionId: SessionId, envelope: SessionEventEnvelope, idx: number): void {
		try {
			this.#deps.listener.onStored(sessionId, envelope, idx);
		} catch (cause) {
			this.#deps.log("error", "Showing a stored chat event failed", cause);
		}
	}

	async #acknowledge(sessionId: SessionId, eventId: SessionEvent["eventId"]): Promise<void> {
		try {
			const sent = await this.#deps.sidecar.notify("eventPersisted", { sessionId, eventId });
			if (!sent.ok) {
				this.#deps.log("warn", "Could not acknowledge a stored chat event", sent.error);
			}
		} catch (cause) {
			this.#deps.log("warn", "Could not acknowledge a stored chat event", cause);
		}
	}
}
