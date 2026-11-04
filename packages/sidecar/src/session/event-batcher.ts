/**
 * @feature SIDE-05 Event batching and live-state notifications
 * Owns: collecting a chat's events, grouping them into batches, writing each batch to the
 * write-ahead log, and only then sending the events to the app.
 * Behaviour: research/conductor/sessions.md section 5 steps 2 to 4 (a single-flight drain loop
 * batches consecutive notifications, up to 50 events or about 838 860 bytes, and retries a failed
 * send with delays 250, 1000, 5000, 15000, 30000 and 60000 ms).
 * Must handle:
 *  - batch limits: at most 50 events and 838 860 bytes (80 percent of 1 MiB); one event larger than
 *    the byte limit still goes out alone
 *  - write before send: the batch is appended to the outbox first; events that failed to write are
 *    never sent
 *  - a failed outbox write: retry with the delay table, keep order, surface the error after the
 *    last delay as a turn error instead of dropping events
 *  - the app is disconnected: events stay in the outbox and are replayed on attach (SIDE-06)
 *  - single flight: one drain loop per chat, so events leave in the order they arrived
 *  - flush(): resolves when everything queued before the call has been written and sent; the live
 *    state store waits on it before it publishes idle
 * Test first: takeBatch on 120 small events returns 50, 50 and 20 in order.
 * Our design choice: the retry table applies to the local write-ahead append. In Conductor it
 * guarded the socket send, which in our design cannot lose data because the log holds the events.
 */
import type { SessionEvent } from "@conducted/protocol";
import type { Clock, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { EventOutbox } from "../outbox/event-outbox.ts";
import type { SidecarToApp } from "../rpc/types.ts";

export const MAX_BATCH_EVENTS = 50;
/** 80 percent of 1 MiB, leaving room for the envelope. */
export const MAX_BATCH_BYTES = Math.floor(1024 * 1024 * 0.8);
export const WRITE_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 5000, 15000, 30000, 60000];

export interface SizedEvent {
	event: SessionEvent;
	/** UTF-8 size of the JSON form of the event. */
	bytes: number;
}

/** Splits queued events into batches that respect both limits, keeping order. */
export function takeBatches(
	events: readonly SizedEvent[],
	limits: { maxEvents: number; maxBytes: number } = {
		maxEvents: MAX_BATCH_EVENTS,
		maxBytes: MAX_BATCH_BYTES,
	},
): SizedEvent[][] {
	const batches: SizedEvent[][] = [];
	let current: SizedEvent[] = [];
	let currentBytes = 0;
	for (const item of events) {
		const full =
			current.length >= limits.maxEvents ||
			(current.length > 0 && currentBytes + item.bytes > limits.maxBytes);
		if (full) {
			batches.push(current);
			current = [];
			currentBytes = 0;
		}
		current.push(item);
		currentBytes += item.bytes;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

export interface EventPublisher {
	/** Queues an event for the chat. Never blocks on the write or the send. */
	publish(sessionId: SessionId, event: SessionEvent): void;
	/** Resolves when all events queued so far are in the log and have been sent (or are pending replay). */
	flush(sessionId: SessionId): Promise<void>;
	/** Reports a write that failed after the last retry. */
	onWriteFailure(listener: (sessionId: SessionId, message: string) => void): void;
}

export class BatchingEventPublisher implements EventPublisher {
	constructor(
		protected readonly deps: {
			outbox: EventOutbox;
			app: SidecarToApp;
			clock: Clock;
			logger: Logger;
			/** Waits between write retries. A parameter so tests do not sleep. */
			sleep(ms: number): Promise<void>;
		},
	) {}

	publish(_sessionId: SessionId, _event: SessionEvent): void {
		notImplemented("SIDE-05");
	}

	flush(_sessionId: SessionId): Promise<void> {
		return notImplemented("SIDE-05");
	}

	onWriteFailure(_listener: (sessionId: SessionId, message: string) => void): void {
		notImplemented("SIDE-05");
	}
}
