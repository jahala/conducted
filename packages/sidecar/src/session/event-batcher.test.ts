import { describe, expect, test } from "bun:test";
import type { SessionConfig, SessionEvent, SessionEventEnvelope } from "@conducted/protocol";
import type {
	AppError,
	CheckpointId,
	EventId,
	MessageId,
	Result,
	SessionId,
	TurnId,
} from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import type { EventOutbox } from "../outbox/event-outbox.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import {
	BatchingEventPublisher,
	jsonBytes,
	MAX_BATCH_BYTES,
	type SizedEvent,
	takeBatches,
} from "./event-batcher.ts";

const sid = (value: string) => value as SessionId;
const tid = "turn-1" as TurnId;

let eventCounter = 0;

function agentEvent(text: string): SessionEvent {
	eventCounter += 1;
	return {
		type: "agent",
		eventId: `event-${eventCounter}` as EventId,
		at: eventCounter,
		turnId: tid,
		message: { agent: "claude", items: [{ kind: "text", text }] },
	};
}

const userConfig: SessionConfig = {
	agent: "claude",
	model: "sonnet",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

class FakeOutbox implements EventOutbox {
	/** Every append attempt, including failed ones. */
	readonly attempts: { sessionId: SessionId; events: readonly SessionEvent[] }[] = [];
	/** The batches that were accepted. */
	readonly appended: { sessionId: SessionId; events: readonly SessionEvent[] }[] = [];
	failures = 0;
	readonly maxActivePerSession = new Map<SessionId, number>();
	private readonly active = new Map<SessionId, number>();
	private readonly sequences = new Map<SessionId, number>();

	async open(): Promise<Result<SessionId[], AppError>> {
		return ok([]);
	}

	async append(
		sessionId: SessionId,
		events: readonly SessionEvent[],
	): Promise<Result<SessionEventEnvelope[], AppError>> {
		this.attempts.push({ sessionId, events: [...events] });
		const active = (this.active.get(sessionId) ?? 0) + 1;
		this.active.set(sessionId, active);
		this.maxActivePerSession.set(
			sessionId,
			Math.max(this.maxActivePerSession.get(sessionId) ?? 0, active),
		);
		await Promise.resolve();
		this.active.set(sessionId, (this.active.get(sessionId) ?? 1) - 1);
		if (this.failures > 0) {
			this.failures -= 1;
			return err(appError("write_failed", "The disk refused the write."));
		}
		this.appended.push({ sessionId, events: [...events] });
		let sequence = this.sequences.get(sessionId) ?? 0;
		const envelopes = events.map((event) => {
			const envelope: SessionEventEnvelope = { sessionId, sequence, event };
			sequence += 1;
			return envelope;
		});
		this.sequences.set(sessionId, sequence);
		return ok(envelopes);
	}

	async acknowledge(_sessionId: SessionId, _eventId: EventId): Promise<Result<void, AppError>> {
		return ok(undefined);
	}

	pending(_sessionId: SessionId): readonly SessionEventEnvelope[] {
		return [];
	}

	sessionsWithPending(): SessionId[] {
		return [];
	}

	async sweepIdle(): Promise<Result<number, AppError>> {
		return ok(0);
	}
}

function harness() {
	const app = new FakeApp();
	const outbox = new FakeOutbox();
	const sleeps: number[] = [];
	const records: LogRecord[] = [];
	const logger = createLogger({
		sink: (record) => records.push(record),
		clock: { now: () => 0 },
		level: "debug",
		scope: "test",
	});
	const publisher = new BatchingEventPublisher({
		outbox,
		app,
		clock: { now: () => 0 },
		logger,
		sleep: async (ms) => {
			sleeps.push(ms);
			await Promise.resolve();
		},
	});
	return { app, outbox, sleeps, records, publisher };
}

function sessionEvents(app: FakeApp): SessionEventEnvelope[] {
	return app.notifications
		.filter((notification) => notification.method === "sessionEvent")
		.map((notification) => notification.params as SessionEventEnvelope);
}

describe("SIDE-05 event batching", () => {
	test("SIDE-05 takeBatches on 120 small events returns 50, 50 and 20 in order", () => {
		const sized = (bytes: number): SizedEvent => ({ event: {} as SessionEvent, bytes });
		const events = Array.from({ length: 120 }, () => sized(10));
		expect(takeBatches(events).map((batch) => batch.length)).toEqual([50, 50, 20]);
	});

	test("SIDE-05 the byte limit closes a batch, and an oversize event goes out alone", () => {
		const sized = (bytes: number): SizedEvent => ({ event: {} as SessionEvent, bytes });
		const events = [sized(60), sized(60), sized(500), sized(10)];
		const batches = takeBatches(events, { maxEvents: 50, maxBytes: 100 });
		expect(batches.map((batch) => batch.map((item) => item.bytes))).toEqual([
			[60],
			[60],
			[500],
			[10],
		]);
	});

	test("SIDE-05 no events give no batches", () => {
		expect(takeBatches([])).toEqual([]);
	});

	test("SIDE-05 writes each batch to the log before sending it, in outbox sequence order", async () => {
		const h = harness();
		const events = Array.from({ length: 60 }, (_, index) => agentEvent(`message ${index}`));
		for (const event of events) h.publisher.publish(sid("session-1"), event);

		await h.publisher.flush(sid("session-1"));

		expect(h.outbox.appended.map((batch) => batch.events.length)).toEqual([50, 10]);
		const envelopes = sessionEvents(h.app);
		expect(envelopes.map((envelope) => envelope.event.eventId)).toEqual(
			events.map((event) => event.eventId),
		);
		expect(envelopes.map((envelope) => envelope.sequence)).toEqual(
			Array.from({ length: 60 }, (_, index) => index),
		);
	});

	test("SIDE-05 keeps one drain per chat and never reorders its events", async () => {
		const h = harness();
		const first = Array.from({ length: 25 }, (_, index) => agentEvent(`a${index}`));
		const second = Array.from({ length: 25 }, (_, index) => agentEvent(`b${index}`));

		for (let index = 0; index < 25; index += 1) {
			const a = first[index];
			const b = second[index];
			if (a !== undefined) h.publisher.publish(sid("session-a"), a);
			if (b !== undefined) h.publisher.publish(sid("session-b"), b);
		}
		await Promise.all([h.publisher.flush(sid("session-a")), h.publisher.flush(sid("session-b"))]);

		const received = (sessionId: string) =>
			sessionEvents(h.app)
				.filter((envelope) => envelope.sessionId === sid(sessionId))
				.map((envelope) => envelope.event.eventId);
		expect(received("session-a")).toEqual(first.map((event) => event.eventId));
		expect(received("session-b")).toEqual(second.map((event) => event.eventId));
		expect(h.outbox.maxActivePerSession.get(sid("session-a"))).toBe(1);
		expect(h.outbox.maxActivePerSession.get(sid("session-b"))).toBe(1);
	});

	test("SIDE-05 a flush resolves only after the events queued before it were sent", async () => {
		const h = harness();
		h.publisher.publish(sid("session-1"), agentEvent("first"));
		const flushed = h.publisher.flush(sid("session-1"));

		h.publisher.publish(sid("session-1"), agentEvent("after the flush"));
		await flushed;
		expect(sessionEvents(h.app)).toHaveLength(1);

		await h.publisher.flush(sid("session-1"));
		expect(sessionEvents(h.app)).toHaveLength(2);
	});

	test("SIDE-05 retries a failed write with the delay table and never drops the event", async () => {
		const h = harness();
		h.outbox.failures = 2;
		const event = agentEvent("survives");
		h.publisher.publish(sid("session-1"), event);

		await h.publisher.flush(sid("session-1"));

		expect(h.sleeps).toEqual([250, 1000]);
		expect(h.outbox.appended).toHaveLength(1);
		expect(sessionEvents(h.app).map((envelope) => envelope.event.eventId)).toEqual([event.eventId]);
	});

	test("SIDE-05 warns has not settled every 60 seconds and reports the error after the last delay", async () => {
		const h = harness();
		const failures: string[] = [];
		h.publisher.onWriteFailure((sessionId, message) => failures.push(`${sessionId}:${message}`));
		h.outbox.failures = 7;
		h.publisher.publish(sid("session-1"), agentEvent("eventually"));

		await h.publisher.flush(sid("session-1"));

		expect(h.sleeps).toEqual([250, 1000, 5000, 15000, 30000, 60000, 60000]);
		expect(failures).toEqual(["session-1:The disk refused the write."]);
		expect(
			h.records.filter(
				(record) => record.level === "warn" && record.message.includes("has not settled"),
			),
		).toHaveLength(1);
		expect(sessionEvents(h.app)).toHaveLength(1);
	});

	test("SIDE-05 with no app attached the events are still written and the flush resolves", async () => {
		const h = harness();
		h.app.connected = false;
		const event = agentEvent("kept for replay");
		h.publisher.publish(sid("session-1"), event);

		await h.publisher.flush(sid("session-1"));

		expect(h.outbox.appended).toHaveLength(1);
		expect(sessionEvents(h.app)).toHaveLength(0);
	});
});

describe("SIDE-05 notifications", () => {
	test("SIDE-05 a user message event carries no state and keeps the agent config", async () => {
		const h = harness();
		const event: SessionEvent = {
			type: "user_message",
			eventId: "user-1" as EventId,
			at: 1,
			messageId: "message-1" as MessageId,
			turnId: tid,
			text: "hello",
			attachmentPaths: [],
			delivery: "new_turn",
			config: userConfig,
		};
		h.publisher.publish(sid("session-1"), event);

		await h.publisher.flush(sid("session-1"));

		const sent = sessionEvents(h.app)[0]?.event;
		expect(sent?.type).toBe("user_message");
		expect(sent !== undefined && "state" in sent).toBe(false);
		expect(sent?.type === "user_message" ? sent.config.agent : undefined).toBe("claude");
	});

	test("SIDE-05 one event of each kind, a steered user message and a shortened event all pass the protocol schema on the way out", async () => {
		const h = harness();
		const events: SessionEvent[] = [
			{
				type: "user_message",
				eventId: "kind-1" as EventId,
				at: 1,
				messageId: "message-1" as MessageId,
				turnId: tid,
				text: "hello",
				attachmentPaths: ["/work/a.png"],
				delivery: "new_turn",
				config: userConfig,
			},
			{
				type: "user_message",
				eventId: "kind-2" as EventId,
				at: 2,
				messageId: "message-2" as MessageId,
				turnId: tid,
				text: "also this",
				attachmentPaths: [],
				delivery: "steer",
				config: userConfig,
			},
			agentEvent("an answer"),
			{
				type: "checkpoint",
				eventId: "kind-3" as EventId,
				at: 3,
				turnId: tid,
				phase: "end",
				checkpointId: "checkpoint-1" as CheckpointId,
				changes: [
					{ path: "a.ts", status: "modified", linesAdded: 2, linesRemoved: 1, binary: false },
				],
			},
			{
				type: "agent",
				eventId: "kind-4" as EventId,
				at: 4,
				turnId: tid,
				message: {
					agent: "claude",
					items: [{ kind: "text", text: "T".repeat(900_000) }],
					raw: { blob: "R".repeat(1_200_000) },
				},
			},
			{
				type: "turn_ended",
				eventId: "kind-5" as EventId,
				at: 5,
				turnId: tid,
				outcome: "error",
				error: "The agent stopped.",
			},
		];
		for (const event of events) h.publisher.publish(sid("session-1"), event);

		await h.publisher.flush(sid("session-1"));

		expect(h.app.refused).toEqual([]);
		expect(sessionEvents(h.app).map((envelope) => envelope.event.type)).toEqual([
			"user_message",
			"user_message",
			"agent",
			"checkpoint",
			"agent",
			"turn_ended",
		]);
	});

	test("SIDE-05 a notification over the byte limit keeps its head and tail with the original size", async () => {
		const h = harness();
		const longText = `${"A".repeat(900_000)}THE END`;
		const event: SessionEvent = {
			type: "agent",
			eventId: "big-1" as EventId,
			at: 1,
			turnId: tid,
			message: {
				agent: "claude",
				items: [{ kind: "text", text: longText }],
				raw: { blob: "B".repeat(1_200_000) },
			},
		};
		h.publisher.publish(sid("session-1"), event);

		await h.publisher.flush(sid("session-1"));

		const sent = sessionEvents(h.app)[0];
		expect(sent).toBeDefined();
		expect(jsonBytes(sent)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
		const message = sent?.event.type === "agent" ? sent.event.message : undefined;
		const text = message?.items[0]?.kind === "text" ? message.items[0].text : "";
		expect(text.startsWith("AAAA")).toBe(true);
		expect(text.endsWith("THE END")).toBe(true);
		expect(text).toContain(`shortened from ${longText.length} bytes`);
		expect(message?.raw).toMatchObject({ truncated: true });
	});
});
