import { describe, expect, test } from "bun:test";
import type { SessionEvent, SessionEventEnvelope } from "@conducted/protocol";
import type { AppError, EventId, Result, SessionId, TurnId } from "@conducted/shared";
import { appError, createKeyedQueue, err, ok } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import { MemoryStorage } from "../test-support/memory-storage.ts";
import { until } from "../test-support/until.ts";
import { FileEventOutbox } from "./event-outbox.ts";
import { OutboxReplayer, REPLAY_TIMEOUT_MS } from "./replay.ts";

const sid = (value: string) => value as SessionId;

let eventCounter = 0;

function endedEvent(): SessionEvent {
	eventCounter += 1;
	return {
		type: "turn_ended",
		eventId: `event-${eventCounter}` as EventId,
		at: eventCounter,
		turnId: "turn-1" as TurnId,
		outcome: "success",
	};
}

type Reply = Result<{ persisted: boolean }, AppError>;

async function harness() {
	const storage = new MemoryStorage();
	const outbox = new FileEventOutbox({
		storage,
		queue: createKeyedQueue(),
		clock: { now: () => 1_000 },
		logger: createLogger({
			sink: () => {},
			clock: { now: () => 0 },
			level: "debug",
			scope: "test",
		}),
	});
	await outbox.open();
	const records: LogRecord[] = [];
	const logger = createLogger({
		sink: (record) => records.push(record),
		clock: { now: () => 0 },
		level: "debug",
		scope: "test",
	});
	const app = new FakeApp();
	const replayer = new OutboxReplayer({ outbox, app, logger });
	return { outbox, app, replayer, records };
}

async function appendEvents(
	outbox: FileEventOutbox,
	sessionId: SessionId,
	count: number,
): Promise<SessionEvent[]> {
	const events = Array.from({ length: count }, () => endedEvent());
	const appended = await outbox.append(sessionId, events);
	if (!appended.ok) throw new Error(appended.error.message);
	return events;
}

describe("SIDE-06 replay", () => {
	test("SIDE-06 replayAll started on an empty log picks up events appended later", async () => {
		const h = await harness();
		await h.replayer.replayAll();
		expect(h.app.requested("deliverEvent")).toEqual([]);

		await appendEvents(h.outbox, sid("session-1"), 1);
		await h.replayer.replayAll();

		expect(h.app.requested("deliverEvent").map((envelope) => envelope.sequence)).toEqual([0]);
		expect(h.outbox.pending(sid("session-1"))).toEqual([]);
	});

	test("SIDE-06 3 pending events with persisted true are delivered in sequence order and leave the log", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);

		await h.replayer.replayAll();

		const delivered = h.app.requested("deliverEvent");
		expect(delivered.map((envelope) => envelope.sequence)).toEqual([0, 1, 2]);
		expect(h.app.requests.map((request) => request.options?.timeoutMs)).toEqual([
			REPLAY_TIMEOUT_MS,
			REPLAY_TIMEOUT_MS,
			REPLAY_TIMEOUT_MS,
		]);
		expect(h.outbox.pending(sid("session-1"))).toEqual([]);
	});

	test("SIDE-06 persisted false stops that chat and leaves the rest pending", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);
		let calls = 0;
		h.app.reply = async () => {
			calls += 1;
			return ok({ persisted: calls !== 2 });
		};

		await h.replayer.replayAll();

		expect(h.app.requested("deliverEvent").map((envelope) => envelope.sequence)).toEqual([0, 1]);
		expect(h.outbox.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([1, 2]);
	});

	test("SIDE-06 a failed delivery stops the chat and keeps the events for the next attach", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);
		let calls = 0;
		h.app.reply = async () => {
			calls += 1;
			if (calls === 2) return err(appError("rpc_timeout", "The app did not answer in time."));
			return ok({ persisted: true });
		};

		await h.replayer.replayAll();

		expect(h.app.requested("deliverEvent")).toHaveLength(2);
		expect(h.outbox.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([1, 2]);
		expect(
			h.records.filter(
				(record) => record.level === "warn" && record.message.includes("Replay stopped"),
			),
		).toHaveLength(1);
	});

	test("SIDE-06 an app that disconnects mid-replay stops it quietly", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);
		h.app.reply = async () => {
			h.app.connected = false;
			return ok({ persisted: true });
		};

		await h.replayer.replayAll();

		expect(h.app.requested("deliverEvent")).toHaveLength(1);
		expect(h.outbox.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([1, 2]);
		expect(h.records.filter((record) => record.level === "warn")).toEqual([]);
	});

	test("SIDE-06 with no app attached nothing is delivered and everything stays pending", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 2);
		h.app.connected = false;

		await h.replayer.replayAll();

		expect(h.app.requested("deliverEvent")).toEqual([]);
		expect(h.outbox.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([0, 1]);
	});

	test("SIDE-06 an attach during a running replay starts no second one", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.app.beforeReply = async () => {
			await gate;
		};

		const first = h.replayer.replayAll();
		const second = h.replayer.replayAll();
		expect(second).toBe(first);
		release();
		await Promise.all([first, second]);

		expect(h.app.requested("deliverEvent").map((envelope) => envelope.sequence)).toEqual([0, 1, 2]);
	});

	test("SIDE-06 an attach that replaces a connection mid-request still replays on the new one", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 2);
		let calls = 0;
		let failFirst: () => void = () => {};
		h.app.reply = async () => {
			calls += 1;
			if (calls === 1) {
				// The old connection drops with the request in flight.
				return new Promise<Reply>((resolve) => {
					failFirst = () =>
						resolve(err(appError("connection_closed", "The app connection closed")));
				});
			}
			return ok({ persisted: true });
		};

		const first = h.replayer.replayAll();
		await until(() => calls === 1);
		// The new connection attaches, then the old request is rejected.
		const second = h.replayer.replayAll();
		failFirst();
		await Promise.all([first, second]);

		expect(h.outbox.pending(sid("session-1"))).toHaveLength(0);
	});

	test("SIDE-06 replay sends one request at a time and goes chat by chat", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-a"), 2);
		await appendEvents(h.outbox, sid("session-b"), 1);

		await h.replayer.replayAll();

		expect(
			h.app
				.requested("deliverEvent")
				.map((envelope) => `${envelope.sessionId}:${envelope.sequence}`),
		).toEqual(["session-a:0", "session-a:1", "session-b:0"]);
		expect(h.app.maxActiveRequests).toBe(1);
	});

	test("SIDE-06 an acknowledgement that arrives during replay does not break it", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);
		let calls = 0;
		h.app.beforeReply = async (_method, params) => {
			const envelope = params as SessionEventEnvelope;
			calls += 1;
			if (calls !== 1) return;
			const second = h.outbox.pending(sid("session-1"))[1];
			if (second === undefined) throw new Error("missing event");
			const acknowledged = await h.outbox.acknowledge(sid("session-1"), second.event.eventId);
			if (!acknowledged.ok) throw new Error(acknowledged.error.message);
			expect(envelope.sequence).toBe(0);
		};

		await h.replayer.replayAll();

		// The second event was acknowledged before it was sent, so replay must skip it.
		expect(h.app.requested("deliverEvent").map((envelope) => envelope.sequence)).toEqual([0, 2]);
		expect(h.outbox.pending(sid("session-1"))).toEqual([]);
	});
});
