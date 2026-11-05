/**
 * @feature SIDE-06 Write-ahead event log: replay on reconnect
 * Owns: resending the events the app has not confirmed, each time a connection attaches and once
 * after open().
 * Behaviour: research/conductor/sessions.md section 5 "Replay path": for each chat with pending
 * entries, one at a time, send a deliverEvent request and wait up to 10 s for the matching
 * confirmation. If no app is connected the events stay in the log.
 * Must handle:
 *  - events are replayed in sequence order, one request at a time, chat by chat
 *  - a reply { persisted: true } acknowledges the event; { persisted: false } or a timeout stops
 *    that chat's replay and leaves the rest pending for the next attach
 *  - the app disconnects in the middle: stop quietly; the next attach starts again
 *  - single flight: attach during a running replay does not start a second one
 *  - live events keep flowing during a replay; the app stores by event id, so a duplicate is safe
 *  - an eventPersisted notification that arrives for an event being replayed acknowledges it once
 * Test first: with 3 pending events and an app that answers persisted true, deliverEvent is called
 * 3 times in sequence order and the outbox is empty afterwards.
 */
import type { SessionId } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { SidecarToApp } from "../rpc/types.ts";
import type { EventOutbox } from "./event-outbox.ts";

/** How long to wait for the app to store one replayed event. From the research. */
export const REPLAY_TIMEOUT_MS = 10_000;

export class OutboxReplayer {
	private all: Promise<void> | null = null;
	private readonly sessions = new Map<SessionId, Promise<void>>();

	constructor(
		protected readonly deps: {
			outbox: EventOutbox;
			app: SidecarToApp;
			logger: Logger;
		},
	) {}

	/** Replays every chat with pending events. Resolves when done or when the app went away. */
	replayAll(): Promise<void> {
		if (this.all !== null) return this.all;
		// Start on a microtask so this.all is assigned before an empty log can finish the body.
		const run = Promise.resolve()
			.then(async () => {
				for (const sessionId of this.deps.outbox.sessionsWithPending()) {
					await this.replaySession(sessionId);
				}
			})
			.finally(() => {
				this.all = null;
			});
		this.all = run;
		return run;
	}

	replaySession(sessionId: SessionId): Promise<void> {
		const running = this.sessions.get(sessionId);
		if (running !== undefined) return running;
		const run = this.runSession(sessionId).finally(() => {
			if (this.sessions.get(sessionId) === run) this.sessions.delete(sessionId);
		});
		this.sessions.set(sessionId, run);
		return run;
	}

	private async runSession(sessionId: SessionId): Promise<void> {
		while (true) {
			// Read the head each time: an eventPersisted notification may have removed it while
			// the previous delivery was in flight, and that event must not be sent twice.
			const envelope = this.deps.outbox.pending(sessionId)[0];
			if (envelope === undefined) return;
			if (!this.deps.app.connected) {
				this.deps.logger.debug("No app is attached; the event log waits for the next connection", {
					sessionId,
				});
				return;
			}
			const delivered = await this.deps.app.request("deliverEvent", envelope, {
				timeoutMs: REPLAY_TIMEOUT_MS,
			});
			if (!delivered.ok) {
				if (this.deps.app.connected) {
					this.deps.logger.warn("Replay stopped before the app acknowledged an event", {
						sessionId,
						eventId: envelope.event.eventId,
						reason: delivered.error.message,
					});
				}
				return;
			}
			if (!delivered.value.persisted) {
				this.deps.logger.debug("The app did not store a replayed event; it stays in the log", {
					sessionId,
					eventId: envelope.event.eventId,
				});
				return;
			}
			const acknowledged = await this.deps.outbox.acknowledge(sessionId, envelope.event.eventId);
			if (!acknowledged.ok) {
				this.deps.logger.warn("A replayed event could not leave the log", {
					sessionId,
					eventId: envelope.event.eventId,
					reason: acknowledged.error.message,
				});
				return;
			}
		}
	}
}
