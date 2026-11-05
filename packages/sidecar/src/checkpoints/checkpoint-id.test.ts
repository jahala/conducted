import { describe, expect, test } from "bun:test";
import type { SessionId, TurnId } from "@conducted/shared";
import {
	CHECKPOINT_REF_PREFIX,
	CHECKPOINTER_EXIT,
	checkpointIdFor,
	checkpointRefFor,
	exitCodeToOutcome,
} from "./checkpoint-id.ts";

const sid = (value: string) => value as SessionId;
const tid = (value: string) => value as TurnId;

describe("SIDE-08 checkpoint ids, refs and exit codes", () => {
	test("an id is built from the session id, the turn id and the phase", () => {
		const start = checkpointIdFor(sid("s1"), tid("t1"), "start");
		const end = checkpointIdFor(sid("s1"), tid("t1"), "end");

		expect(start).toBe("session-s1-turn-t1-start" as typeof start);
		expect(end).toBe("session-s1-turn-t1-end" as typeof end);
	});

	test("the private ref lives under our own namespace", () => {
		const id = checkpointIdFor(sid("s1"), tid("t1"), "start");
		expect(id).not.toBeNull();
		if (id) {
			expect(CHECKPOINT_REF_PREFIX).toBe("refs/conducted/checkpoints/");
			expect(checkpointRefFor(id)).toBe("refs/conducted/checkpoints/session-s1-turn-t1-start");
		}
	});

	test("an id with a character git refs forbid is refused, not cleaned", () => {
		expect(checkpointIdFor(sid("a b"), tid("t"), "end")).toBeNull();
		expect(checkpointIdFor(sid("a"), tid("t/../x"), "end")).toBeNull();
		expect(checkpointIdFor(sid("a"), tid("t~1"), "end")).toBeNull();
	});

	test("exit code 101 is a skip for a merge or rebase in progress", () => {
		expect(exitCodeToOutcome(101)).toEqual({
			kind: "skipped",
			reason: "merge_in_progress",
			detail: "A merge or rebase is running",
		});
	});

	test("exit codes map to outcomes", () => {
		expect(exitCodeToOutcome(0)).toEqual({ kind: "created" });
		expect(exitCodeToOutcome(102)).toMatchObject({ reason: "conflicts" });
		expect(exitCodeToOutcome(103)).toMatchObject({ reason: "failed" });
		expect(exitCodeToOutcome(64)).toMatchObject({ reason: "failed" });
		expect(exitCodeToOutcome(143)).toMatchObject({
			reason: "failed",
			detail: "The checkpointer timed out and was stopped",
		});
		expect(exitCodeToOutcome(9)).toMatchObject({
			reason: "failed",
			detail: "The checkpointer exited with code 9",
		});
	});

	test("bin/checkpointer.sh documents every exit code and the ref prefix used here", async () => {
		const script = await Bun.file(`${import.meta.dir}/../../../../bin/checkpointer.sh`).text();
		const header = script.slice(0, script.indexOf("set -euo pipefail"));
		for (const code of Object.values(CHECKPOINTER_EXIT)) {
			if (code === 0 || code === 1) continue;
			expect(header).toContain(`#   ${code} `);
		}
		expect(header).toContain(CHECKPOINT_REF_PREFIX);
	});
});
