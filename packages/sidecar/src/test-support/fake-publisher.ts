/**
 * @feature SIDE-05 Event batching and live-state notifications
 * Owns: the one stand-in for the event publisher (EventPublisher) that session tests use. It
 * records every published event and refuses an event the protocol schema refuses.
 * Behaviour: session/event-batcher.ts. The real pipeline sends each event to the app, where the
 * RpcPeer checks it with `zSessionEvent`; an event that fails there is never delivered and, once
 * written to the log, stops the next start (H-4). This fake checks the same schema at publish.
 * Must handle: an invalid event (throws by default, so the test cannot miss it), an optional order
 * log shared with other fakes, and flush calls recorded per chat.
 * Test first: fake-publisher.test.ts, "an event the schema refuses is refused at publish".
 */
import { type SessionEvent, zSessionEvent } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import type { EventPublisher } from "../session/event-batcher.ts";

/** The label a test shares with other fakes to check order, for example "event:checkpoint:start". */
export function eventLabel(event: SessionEvent): string {
	if (event.type === "checkpoint") return `event:checkpoint:${event.phase}`;
	return `event:${event.type}`;
}

export class FakePublisher implements EventPublisher {
	readonly events: { sessionId: SessionId; event: SessionEvent }[] = [];
	readonly flushed: SessionId[] = [];
	private readonly listeners: ((sessionId: SessionId, message: string) => void)[] = [];

	/** `order` is shared with other fakes: this one adds "event:<type>" and "flush" entries. */
	constructor(private readonly order?: string[]) {}

	publish(sessionId: SessionId, event: SessionEvent): void {
		const parsed = zSessionEvent.safeParse(event);
		if (!parsed.success) {
			throw new Error(
				`The schema refuses this ${String((event as { type?: unknown }).type)} event: ${JSON.stringify(parsed.error.issues)}`,
			);
		}
		this.events.push({ sessionId, event });
		this.order?.push(eventLabel(event));
	}

	async flush(sessionId: SessionId): Promise<void> {
		this.flushed.push(sessionId);
		this.order?.push("flush");
	}

	onWriteFailure(listener: (sessionId: SessionId, message: string) => void): void {
		this.listeners.push(listener);
	}

	/** Reports a write failure to the listeners, as the real publisher does after its last retry. */
	failWrite(sessionId: SessionId, message: string): void {
		for (const listener of this.listeners) listener(sessionId, message);
	}
}
