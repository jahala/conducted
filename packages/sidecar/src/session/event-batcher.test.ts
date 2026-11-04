import { expect, test } from "bun:test";
import type { SessionEvent } from "@conducted/protocol";
import { type SizedEvent, takeBatches } from "./event-batcher.ts";

const sized = (bytes: number): SizedEvent => ({ event: {} as SessionEvent, bytes });

test("120 small events become batches of 50, 50 and 20 in order", () => {
	const events = Array.from({ length: 120 }, () => sized(10));
	expect(takeBatches(events).map((batch) => batch.length)).toEqual([50, 50, 20]);
});

test("the byte limit closes a batch, and an oversize event goes out alone", () => {
	const events = [sized(60), sized(60), sized(500), sized(10)];
	const batches = takeBatches(events, { maxEvents: 50, maxBytes: 100 });
	expect(batches.map((batch) => batch.map((item) => item.bytes))).toEqual([
		[60],
		[60],
		[500],
		[10],
	]);
});

test("no events give no batches", () => {
	expect(takeBatches([])).toEqual([]);
});
