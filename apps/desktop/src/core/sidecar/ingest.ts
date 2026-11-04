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
 * changes. The in-memory store is updated after the commit, so a failed write never shows.
 * Test first: ingesting the same envelope twice stores one row and sends two acknowledgements.
 */
import type { SessionEventEnvelope } from "@conducted/protocol";
import { notImplemented, type Result, type SessionId } from "@conducted/shared";
import type { Repositories } from "../db/repositories.ts";
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

export class EventIngest {
	readonly #deps: EventIngestDeps;

	constructor(deps: EventIngestDeps) {
		this.#deps = deps;
	}

	/** Handles one envelope. Resolves after the acknowledgement was sent or deliberately withheld. */
	ingest(_envelope: SessionEventEnvelope): Promise<Result<IngestOutcome>> {
		void this.#deps;
		return notImplemented("DATA-04");
	}

	/** Waits until every queued event of every chat has been handled. Used by tests and shutdown. */
	idle(): Promise<void> {
		return notImplemented("DATA-04");
	}
}
