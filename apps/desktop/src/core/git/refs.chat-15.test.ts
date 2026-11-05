/**
 * @feature CHAT-15 Names of the private git refs
 * Tests the ref spelling the UI and bin/checkpointer.sh share for a turn's start and end checkpoints.
 * Test first: checkpointRef(turnCheckpointId("s1", "t1", "start")) is
 * "refs/conducted/checkpoints/session-s1-turn-t1-start".
 */
import { describe, expect, it } from "vitest";
import { checkpointRef, sessionCheckpointRefPrefix, turnCheckpointId } from "./refs.ts";

describe("CHAT-15 checkpoint refs", () => {
	it("builds the start and end refs of a turn", () => {
		expect(checkpointRef(turnCheckpointId("s1", "t1", "start"))).toBe(
			"refs/conducted/checkpoints/session-s1-turn-t1-start",
		);
		expect(checkpointRef(turnCheckpointId("s1", "t1", "end"))).toBe(
			"refs/conducted/checkpoints/session-s1-turn-t1-end",
		);
	});

	it("keeps one chat's prefix away from a chat id it starts with", () => {
		const prefix = sessionCheckpointRefPrefix("s1");
		expect(checkpointRef(turnCheckpointId("s1", "t9", "end")).startsWith(prefix)).toBe(true);
		expect(checkpointRef(turnCheckpointId("s10", "t9", "end")).startsWith(prefix)).toBe(false);
	});
});
