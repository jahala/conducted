import type { SessionEvent } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import { mergeEvents } from "./chat-history.ts";
import type { StoredEvent } from "./turn-builder.ts";

const row = (idx: number, from: string): StoredEvent => ({
	idx,
	event: { eventId: `${from}-${idx}` } as unknown as SessionEvent,
	receivedAt: 0,
	revertedAt: null,
});
const ids = (rows: readonly StoredEvent[]): string[] => rows.map((entry) => entry.event.eventId);

describe("CHAT-06 merging loaded events", () => {
	it("puts an older turn's events before the loaded ones, in idx order", () => {
		const kept = [row(5, "kept"), row(6, "kept")];
		expect(ids(mergeEvents(kept, [row(3, "read"), row(1, "read"), row(2, "read")]))).toEqual([
			"read-1",
			"read-2",
			"read-3",
			"kept-5",
			"kept-6",
		]);
	});

	it("keeps each idx once, the loaded event first, and interleaves where the log does", () => {
		const kept = [row(2, "kept"), row(4, "kept")];
		const added = [row(4, "read"), row(3, "read"), row(9, "read"), row(3, "again"), row(0, "read")];
		expect(ids(mergeEvents(kept, added))).toEqual([
			"read-0",
			"kept-2",
			"read-3",
			"kept-4",
			"read-9",
		]);
	});
});
