import { describe, expect, test } from "bun:test";
import type {
	SessionEvent,
	SessionEventEnvelope,
	SidecarToAppNotification,
	SidecarToAppRequest,
} from "@conducted/protocol";
import type { AppError, EventId, Result, SessionId, TurnId } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import type {
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "../rpc/types.ts";
import { KeyedSerialQueue } from "../session/serial-queue.ts";
import { FileEventOutbox } from "./event-outbox.ts";
import type { OutboxStorage } from "./outbox-file.ts";
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

class MemoryStorage implements OutboxStorage {
	readonly files = new Map<string, string>();
	async list(): Promise<Result<string[], AppError>> {
		return ok([...this.files.keys()]);
	}
	async read(fileName: string): Promise<Result<string | null, AppError>> {
		return ok(this.files.get(fileName) ?? null);
	}
	async writeAtomic(fileName: string, text: string): Promise<Result<void, AppError>> {
		this.files.set(fileName, text);
		return ok(undefined);
	}
	async moveToTrash(fileName: string): Promise<Result<void, AppError>> {
		this.files.delete(fileName);
		return ok(undefined);
	}
	async cleanTempFiles(): Promise<Result<number, AppError>> {
		return ok(0);
	}
}

type Reply = Result<{ persisted: boolean }, AppError>;

class FakeApp implements SidecarToApp {
	connected = true;
	readonly requests: {
		method: SidecarToAppRequest;
		params: unknown;
		options?: { timeoutMs?: number };
	}[] = [];
	reply: (envelope: SessionEventEnvelope) => Promise<Reply> = async () => ok({ persisted: true });
	beforeDeliver: ((envelope: SessionEventEnvelope) => Promise<void>) | null = null;
	private active = 0;
	maxActive = 0;

	async request<K extends SidecarToAppRequest>(
		method: K,
		params: SidecarToAppRequestParams<K>,
		options?: { timeoutMs?: number },
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		this.requests.push({ method, params, options });
		if (method !== "deliverEvent") return ok({} as SidecarToAppRequestResult<K>);
		this.active += 1;
		this.maxActive = Math.max(this.maxActive, this.active);
		try {
			const envelope = params as unknown as SessionEventEnvelope;
			if (this.beforeDeliver !== null) await this.beforeDeliver(envelope);
			return (await this.reply(envelope)) as Result<SidecarToAppRequestResult<K>, AppError>;
		} finally {
			this.active -= 1;
		}
	}

	notify<K extends SidecarToAppNotification>(
		_method: K,
		_params: SidecarToAppNotificationParams<K>,
	): boolean {
		return this.connected;
	}

	onAttach(_listener: () => void): () => void {
		return () => {};
	}

	onDetach(_listener: () => void): () => void {
		return () => {};
	}

	delivered(): SessionEventEnvelope[] {
		return this.requests
			.filter((request) => request.method === "deliverEvent")
			.map((request) => request.params as SessionEventEnvelope);
	}
}

async function harness() {
	const storage = new MemoryStorage();
	const outbox = new FileEventOutbox({
		storage,
		queue: new KeyedSerialQueue(),
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
	test("SIDE-06 3 pending events with persisted true are delivered in sequence order and leave the log", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);

		await h.replayer.replayAll();

		const delivered = h.app.delivered();
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

		expect(h.app.delivered().map((envelope) => envelope.sequence)).toEqual([0, 1]);
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

		expect(h.app.delivered()).toHaveLength(2);
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

		expect(h.app.delivered()).toHaveLength(1);
		expect(h.outbox.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([1, 2]);
		expect(h.records.filter((record) => record.level === "warn")).toEqual([]);
	});

	test("SIDE-06 with no app attached nothing is delivered and everything stays pending", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 2);
		h.app.connected = false;

		await h.replayer.replayAll();

		expect(h.app.delivered()).toEqual([]);
		expect(h.outbox.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([0, 1]);
	});

	test("SIDE-06 an attach during a running replay starts no second one", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.app.beforeDeliver = async () => {
			await gate;
		};

		const first = h.replayer.replayAll();
		const second = h.replayer.replayAll();
		expect(second).toBe(first);
		release();
		await Promise.all([first, second]);

		expect(h.app.delivered().map((envelope) => envelope.sequence)).toEqual([0, 1, 2]);
	});

	test("SIDE-06 replay sends one request at a time and goes chat by chat", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-a"), 2);
		await appendEvents(h.outbox, sid("session-b"), 1);

		await h.replayer.replayAll();

		expect(
			h.app.delivered().map((envelope) => `${envelope.sessionId}:${envelope.sequence}`),
		).toEqual(["session-a:0", "session-a:1", "session-b:0"]);
		expect(h.app.maxActive).toBe(1);
	});

	test("SIDE-06 an acknowledgement that arrives during replay does not break it", async () => {
		const h = await harness();
		await appendEvents(h.outbox, sid("session-1"), 3);
		let calls = 0;
		h.app.beforeDeliver = async (envelope) => {
			calls += 1;
			if (calls !== 1) return;
			const second = h.outbox.pending(sid("session-1"))[1];
			if (second === undefined) throw new Error("missing event");
			const acknowledged = await h.outbox.acknowledge(sid("session-1"), second.event.eventId);
			if (!acknowledged.ok) throw new Error(acknowledged.error.message);
			expect(envelope.sequence).toBe(0);
		};

		await h.replayer.replayAll();

		expect(h.outbox.pending(sid("session-1"))).toEqual([]);
	});
});
