/**
 * @feature CLOUD-06 Keep work across sandbox restarts
 * Tests the container entry's turn-end hook: it reports a backup only when the last chat that was
 * working goes idle, and it forgets running chats when the app disconnects.
 */
import { describe, expect, it } from "vitest";
import { turnChangeOf } from "../src/relay.ts";
import { TurnEndTracker } from "./turn-end.ts";

function live(sessionId: string, status: "working" | "idle"): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		method: "liveState",
		params: { sessionId, liveState: { status } },
	});
}

describe("CLOUD-06 the turn-end hook", () => {
	it("reports a turn end only when the last running chat goes idle", () => {
		const tracker = new TurnEndTracker();
		expect(tracker.note(turnChangeOf(live("s1", "working")))).toBe(false);
		expect(tracker.note(turnChangeOf(live("s2", "working")))).toBe(false);
		expect(tracker.note(turnChangeOf(live("s1", "idle")))).toBe(false);
		expect(tracker.note(turnChangeOf(live("s2", "idle")))).toBe(true);
	});

	it("ignores an idle state for a chat that was not working", () => {
		const tracker = new TurnEndTracker();
		expect(tracker.note(turnChangeOf(live("s1", "idle")))).toBe(false);
		expect(tracker.note(null)).toBe(false);
	});

	it("forgets running chats when the app disconnects", () => {
		const tracker = new TurnEndTracker();
		tracker.note(turnChangeOf(live("s1", "working")));
		tracker.reset();
		expect(tracker.note(turnChangeOf(live("s1", "idle")))).toBe(false);
	});
});
