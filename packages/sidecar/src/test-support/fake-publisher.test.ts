/**
 * @feature SIDE-05 Event batching and live-state notifications
 * Owns: the tests of FakePublisher: it refuses an event that the protocol schema refuses, and it
 * keeps the order of events and flushes for tests that share an order log.
 * Test first: "an event the schema refuses is refused at publish".
 */
import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "@conducted/protocol";
import type { EventId, SessionId, TurnId } from "@conducted/shared";
import { FakePublisher } from "./fake-publisher.ts";

const session = "session-1" as SessionId;

function ended(eventId: string): SessionEvent {
	return {
		type: "turn_ended",
		eventId: eventId as EventId,
		at: 1,
		turnId: "turn-1" as TurnId,
		outcome: "success",
	};
}

describe("SIDE-05 FakePublisher", () => {
	test("an event the schema refuses is refused at publish", () => {
		const publisher = new FakePublisher();

		expect(() => publisher.publish(session, ended(""))).toThrow("turn_ended");
		expect(publisher.events).toEqual([]);
	});

	test("valid events are kept in the order they were published", () => {
		const publisher = new FakePublisher();

		publisher.publish(session, ended("event-1"));
		publisher.publish(session, ended("event-2"));

		expect(publisher.events.map((entry) => entry.event.eventId)).toEqual([
			"event-1" as EventId,
			"event-2" as EventId,
		]);
	});

	test("events and flushes land in the shared order log in the order they happened", async () => {
		const order: string[] = [];
		const publisher = new FakePublisher(order);

		publisher.publish(session, ended("event-1"));
		await publisher.flush(session);

		expect(order).toEqual(["event:turn_ended", "flush"]);
		expect(publisher.flushed).toEqual([session]);
	});

	test("a write failure reaches the listener the way the real publisher reports it", () => {
		const publisher = new FakePublisher();
		const seen: string[] = [];
		publisher.onWriteFailure((sessionId, message) => seen.push(`${sessionId}:${message}`));

		publisher.failWrite(session, "The disk refused the write.");

		expect(seen).toEqual(["session-1:The disk refused the write."]);
	});
});
