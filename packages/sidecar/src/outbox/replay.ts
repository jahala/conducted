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
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { SidecarToApp } from "../rpc/types.ts";
import type { EventOutbox } from "./event-outbox.ts";

/** How long to wait for the app to store one replayed event. From the research. */
export const REPLAY_TIMEOUT_MS = 10_000;

export class OutboxReplayer {
	constructor(
		protected readonly deps: {
			outbox: EventOutbox;
			app: SidecarToApp;
			logger: Logger;
		},
	) {}

	/** Replays every chat with pending events. Resolves when done or when the app went away. */
	replayAll(): Promise<void> {
		return notImplemented("SIDE-06");
	}

	replaySession(_sessionId: SessionId): Promise<void> {
		return notImplemented("SIDE-06");
	}
}
