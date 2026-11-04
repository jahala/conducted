import { describe, expect, it } from "vitest";
import {
	archiveRef,
	checkpointRef,
	sessionCheckpointRefPrefix,
	syncedBaselineRef,
	turnCheckpointId,
} from "./refs.ts";

describe("checkpoint refs", () => {
	it("builds the ref of a turn checkpoint", () => {
		expect(checkpointRef(turnCheckpointId("s1", "t1", "start"))).toBe(
			"refs/conducted/checkpoints/session-s1-turn-t1-start",
		);
	});
	it("builds a prefix that covers one chat only", () => {
		const prefix = sessionCheckpointRefPrefix("s1");
		expect(checkpointRef(turnCheckpointId("s1", "t9", "end")).startsWith(prefix)).toBe(true);
		expect(checkpointRef(turnCheckpointId("s10", "t9", "end")).startsWith(prefix)).toBe(false);
	});
	it("pins an archived workspace under its own ref", () => {
		expect(archiveRef("w1")).toBe("refs/conducted/archive/w1");
	});
	it("keeps the stack sync baseline in a per-worktree ref", () => {
		expect(syncedBaselineRef("abc")).toBe("refs/worktree/conducted/synced/abc");
	});
});
