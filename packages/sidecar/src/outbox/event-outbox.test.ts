import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "@conducted/protocol";
import type { EventId, SessionId, TurnId } from "@conducted/shared";
import { createKeyedQueue } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import { MemoryStorage } from "../test-support/memory-storage.ts";
import {
	FileEventOutbox,
	IDLE_FILE_RETENTION_MS,
	MAX_PENDING_PER_SESSION,
} from "./event-outbox.ts";
import { fileNameFor, OUTBOX_FILE_VERSION } from "./outbox-file.ts";

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

function harness() {
	const storage = new MemoryStorage();
	const records: LogRecord[] = [];
	let now = 1_000;
	const clock = { now: () => now };
	const logger = createLogger({
		sink: (record) => records.push(record),
		clock,
		level: "debug",
		scope: "test",
	});
	const build = () =>
		new FileEventOutbox({
			storage,
			queue: createKeyedQueue(),
			clock,
			logger,
		});
	return {
		storage,
		records,
		clock,
		build,
		advance(ms: number) {
			now += ms;
		},
	};
}

describe("SIDE-06 event outbox", () => {
	test("SIDE-06 append 3 events, restart, and acknowledge the middle one", async () => {
		const h = harness();
		const first = h.build();
		expect((await first.open()).ok).toBe(true);

		const events = [endedEvent(), endedEvent(), endedEvent()];
		const appended = await first.append(sid("session-1"), events);
		expect(appended.ok).toBe(true);
		if (!appended.ok) return;
		expect(appended.value.map((envelope) => envelope.sequence)).toEqual([0, 1, 2]);

		const restarted = h.build();
		expect((await restarted.open()).ok).toBe(true);
		expect(restarted.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([
			0, 1, 2,
		]);
		expect(restarted.pending(sid("session-1")).map((envelope) => envelope.event.eventId)).toEqual(
			events.map((event) => event.eventId),
		);

		const middle = events[1];
		if (middle === undefined) throw new Error("missing event");
		expect((await restarted.acknowledge(sid("session-1"), middle.eventId)).ok).toBe(true);
		expect(restarted.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([
			0, 2,
		]);
	});

	test("SIDE-06 one append is one atomic file write holding the whole batch", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();

		await outbox.append(sid("session-1"), [endedEvent(), endedEvent(), endedEvent()]);

		expect(h.storage.writes).toHaveLength(1);
		const written = h.storage.writes[0];
		if (written === undefined) throw new Error("missing write");
		expect(written.fileName).toBe(fileNameFor("session-1"));
		const file = JSON.parse(written.text) as {
			version: number;
			nextSequence: number;
			pending: unknown[];
			updatedAt: number;
		};
		expect(file.version).toBe(OUTBOX_FILE_VERSION);
		expect(file.nextSequence).toBe(3);
		expect(file.pending).toHaveLength(3);
		expect(file.updatedAt).toBe(1_000);
	});

	test("SIDE-06 sequence numbers keep increasing after a restart and an acknowledgement", async () => {
		const h = harness();
		const first = h.build();
		await first.open();
		await first.append(sid("session-1"), [endedEvent(), endedEvent()]);
		await first.acknowledge(
			sid("session-1"),
			(first.pending(sid("session-1"))[0]?.event.eventId ?? "") as EventId,
		);

		const restarted = h.build();
		await restarted.open();
		const next = endedEvent();
		const appended = await restarted.append(sid("session-1"), [next]);
		expect(appended.ok).toBe(true);
		if (!appended.ok) return;
		expect(appended.value[0]?.sequence).toBe(2);
		expect(restarted.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([
			1, 2,
		]);
	});

	test("SIDE-06 an acknowledgement may name any pending event or an event already gone", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();
		const events = [endedEvent(), endedEvent(), endedEvent()];
		await outbox.append(sid("session-1"), events);

		const last = events[2];
		if (last === undefined) throw new Error("missing event");
		expect((await outbox.acknowledge(sid("session-1"), last.eventId)).ok).toBe(true);
		expect(outbox.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([0, 1]);

		// A replayed acknowledgement for an event already removed is not an error.
		expect((await outbox.acknowledge(sid("session-1"), last.eventId)).ok).toBe(true);
		expect(outbox.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([0, 1]);
	});

	test("SIDE-06 a failed write rolls back and the retry gets the same sequence numbers", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();
		h.storage.failWrites = 1;

		const failed = await outbox.append(sid("session-1"), [endedEvent(), endedEvent()]);
		expect(failed.ok).toBe(false);
		if (failed.ok) return;
		expect(failed.error.code).toBe("outbox_write_failed");
		expect(outbox.pending(sid("session-1"))).toEqual([]);

		const retried = await outbox.append(sid("session-1"), [endedEvent(), endedEvent()]);
		expect(retried.ok).toBe(true);
		if (!retried.ok) return;
		expect(retried.value.map((envelope) => envelope.sequence)).toEqual([0, 1]);
		expect(h.storage.writes).toHaveLength(2);
	});

	test("SIDE-06 a directory fsync failure marks the chat uncertain and append refuses until a restart", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();

		h.storage.failWrites = 1;
		h.storage.failCode = "outbox_dir_sync_failed";
		const failed = await outbox.append(sid("session-1"), [endedEvent()]);
		expect(failed.ok).toBe(false);
		if (failed.ok) return;
		expect(failed.error.code).toBe("outbox_dir_sync_failed");
		expect(outbox.durabilityUncertain(sid("session-1"))).toBe(true);
		expect(outbox.pending(sid("session-1"))).toEqual([]);
		// The rename landed even though its directory entry was not flushed.
		expect(h.storage.files.has(fileNameFor("session-1"))).toBe(true);
		expect(
			h.records.filter(
				(record) => record.level === "warn" && record.message.includes("durability is uncertain"),
			),
		).toHaveLength(1);

		const refused = await outbox.append(sid("session-1"), [endedEvent()]);
		expect(refused.ok).toBe(false);
		if (refused.ok) return;
		expect(refused.error.code).toBe("outbox_durability_uncertain");
		// The refusal does not attempt another write.
		expect(h.storage.writes).toHaveLength(1);

		const restarted = h.build();
		expect((await restarted.open()).ok).toBe(true);
		expect(restarted.durabilityUncertain(sid("session-1"))).toBe(false);
		expect(restarted.pending(sid("session-1")).map((envelope) => envelope.sequence)).toEqual([0]);
	});

	test("SIDE-06 only a directory fsync failure marks durability uncertain", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();
		await outbox.append(sid("session-1"), [endedEvent()]);

		h.storage.failWrites = 1;
		h.storage.failCode = "outbox_write_failed";
		const failed = await outbox.append(sid("session-1"), [endedEvent()]);
		expect(failed.ok).toBe(false);
		if (failed.ok) return;
		expect(failed.error.code).toBe("outbox_write_failed");
		expect(outbox.durabilityUncertain(sid("session-1"))).toBe(false);

		// An ordinary failure rolls back, so the retry is allowed and keeps the sequence.
		const retried = await outbox.append(sid("session-1"), [endedEvent()]);
		expect(retried.ok).toBe(true);
		if (!retried.ok) return;
		expect(retried.value[0]?.sequence).toBe(1);
	});

	test("SIDE-06 an acknowledgement write restores durability after a directory fsync failure", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();
		await outbox.append(sid("session-1"), [endedEvent()]);

		h.storage.failWrites = 1;
		h.storage.failCode = "outbox_dir_sync_failed";
		const failed = await outbox.append(sid("session-1"), [endedEvent()]);
		expect(failed.ok).toBe(false);
		expect(outbox.durabilityUncertain(sid("session-1"))).toBe(true);

		const head = outbox.pending(sid("session-1"))[0];
		if (head === undefined) throw new Error("missing event");
		const acknowledged = await outbox.acknowledge(sid("session-1"), head.event.eventId);
		expect(acknowledged.ok).toBe(true);
		expect(outbox.durabilityUncertain(sid("session-1"))).toBe(false);
		expect(
			h.records.filter(
				(record) => record.level === "info" && record.message === "The event log is durable again",
			),
		).toHaveLength(1);

		const next = await outbox.append(sid("session-1"), [endedEvent()]);
		expect(next.ok).toBe(true);
	});

	test("SIDE-06 an empty append writes nothing", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();
		const appended = await outbox.append(sid("session-1"), []);
		expect(appended).toEqual({ ok: true, value: [] });
		expect(h.storage.writes).toEqual([]);
	});

	test("SIDE-06 a chat refuses events above 20 000 pending ones", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();
		const full = Array.from({ length: MAX_PENDING_PER_SESSION }, () => endedEvent());
		const accepted = await outbox.append(sid("session-1"), full);
		expect(accepted.ok).toBe(true);

		const refused = await outbox.append(sid("session-1"), [endedEvent()]);
		expect(refused.ok).toBe(false);
		if (refused.ok) return;
		expect(refused.error.code).toBe("outbox_full");
		expect(outbox.pending(sid("session-1"))).toHaveLength(MAX_PENDING_PER_SESSION);
	});

	test("SIDE-06 a corrupt file blocks the chat and is kept unchanged", async () => {
		const h = harness();
		const fileName = fileNameFor("broken");
		h.storage.files.set(fileName, "{ not json");

		const outbox = h.build();
		const opened = await outbox.open();
		expect(opened.ok).toBe(false);
		if (opened.ok) return;
		expect(opened.error.code).toBe("outbox_corrupt");
		expect(h.storage.files.get(fileName)).toBe("{ not json");
		expect(h.storage.writes).toEqual([]);

		const again = h.build();
		const second = await again.open();
		expect(second.ok).toBe(false);
		expect(h.storage.files.get(fileName)).toBe("{ not json");
	});

	test("SIDE-06 a file written by a newer version is refused and kept", async () => {
		const h = harness();
		const fileName = fileNameFor("future");
		const future = JSON.stringify({
			version: OUTBOX_FILE_VERSION + 1,
			sessionId: "future",
			nextSequence: 0,
			pending: [],
		});
		h.storage.files.set(fileName, future);

		const outbox = h.build();
		const opened = await outbox.open();
		expect(opened.ok).toBe(false);
		if (opened.ok) return;
		expect(opened.error.code).toBe("outbox_corrupt");
		expect(opened.error.message).toContain("newer");
		expect(h.storage.files.get(fileName)).toBe(future);
		expect(h.storage.writes).toEqual([]);
	});

	test("SIDE-06 open drops temp files and returns only the chats with pending events", async () => {
		const h = harness();
		const first = h.build();
		await first.open();
		const kept = endedEvent();
		await first.append(sid("with-pending"), [kept]);
		await first.append(sid("empty-after-ack"), [endedEvent()]);
		const emptied = first.pending(sid("empty-after-ack"))[0];
		if (emptied === undefined) throw new Error("missing event");
		await first.acknowledge(sid("empty-after-ack"), emptied.event.eventId);

		const restarted = h.build();
		const opened = await restarted.open();
		expect(opened.ok).toBe(true);
		if (!opened.ok) return;
		expect(opened.value).toEqual([sid("with-pending")]);
		expect(h.storage.cleanCalls).toBe(2);
	});

	test("SIDE-06 a sweep moves an empty file idle for 30 days to the Trash and keeps pending ones", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();
		await outbox.append(sid("idle"), [endedEvent()]);
		const idleEntry = outbox.pending(sid("idle"))[0];
		if (idleEntry === undefined) throw new Error("missing event");
		await outbox.acknowledge(sid("idle"), idleEntry.event.eventId);

		const active = endedEvent();
		await outbox.append(sid("active"), [active]);

		const before = await outbox.sweepIdle();
		expect(before).toEqual({ ok: true, value: 0 });

		h.advance(IDLE_FILE_RETENTION_MS + 1);
		const swept = await outbox.sweepIdle();
		expect(swept).toEqual({ ok: true, value: 1 });
		expect(h.storage.trashed).toEqual([fileNameFor("idle")]);
		expect(outbox.pending(sid("idle"))).toEqual([]);
		expect(outbox.pending(sid("active")).map((envelope) => envelope.event.eventId)).toEqual([
			active.eventId,
		]);
		expect(h.storage.files.has(fileNameFor("idle"))).toBe(false);
		expect(h.storage.files.has(fileNameFor("active"))).toBe(true);
	});

	test("SIDE-06 a sweep does not lose an append that arrives while it moves a file", async () => {
		const h = harness();
		const outbox = h.build();
		await outbox.open();
		await outbox.append(sid("idle"), [endedEvent()]);
		const first = outbox.pending(sid("idle"))[0];
		if (first === undefined) throw new Error("missing event");
		await outbox.acknowledge(sid("idle"), first.event.eventId);

		h.advance(IDLE_FILE_RETENTION_MS + 1);

		let releaseTrash: () => void = () => {};
		const trashGate = new Promise<void>((resolve) => {
			releaseTrash = resolve;
		});
		let trashStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			trashStarted = resolve;
		});
		h.storage.beforeTrash = async () => {
			trashStarted();
			await trashGate;
		};

		const sweeping = outbox.sweepIdle();
		await started;

		const late = endedEvent();
		const appending = outbox.append(sid("idle"), [late]);
		releaseTrash();
		const [swept, appended] = await Promise.all([sweeping, appending]);

		expect(swept.ok).toBe(true);
		expect(appended.ok).toBe(true);
		if (!appended.ok) return;
		expect(appended.value.map((envelope) => envelope.event.eventId)).toEqual([late.eventId]);
		expect(outbox.pending(sid("idle")).map((envelope) => envelope.event.eventId)).toEqual([
			late.eventId,
		]);
		expect(h.storage.files.has(fileNameFor("idle"))).toBe(true);
	});
});
