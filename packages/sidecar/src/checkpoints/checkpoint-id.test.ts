import { expect, test } from "bun:test";
import type { SessionId, TurnId } from "@conducted/shared";
import {
	CHECKPOINT_REF_PREFIX,
	CHECKPOINTER_EXIT,
	checkpointIdFor,
	checkpointRefFor,
	exitCodeToOutcome,
} from "./checkpoint-id.ts";

test("ids and refs follow the format", () => {
	const id = checkpointIdFor("s1" as SessionId, "t1" as TurnId, "start");
	expect(id).toBe("session-s1-turn-t1-start" as typeof id);
	if (id) expect(checkpointRefFor(id)).toBe("refs/conducted/checkpoints/session-s1-turn-t1-start");
});

test("an id with a character git refs forbid is refused, not cleaned", () => {
	expect(checkpointIdFor("a b" as SessionId, "t" as TurnId, "end")).toBeNull();
	expect(checkpointIdFor("a" as SessionId, "t/../x" as TurnId, "end")).toBeNull();
});

test("exit codes map to outcomes", () => {
	expect(exitCodeToOutcome(0)).toEqual({ kind: "created" });
	expect(exitCodeToOutcome(101)).toMatchObject({ reason: "merge_in_progress" });
	expect(exitCodeToOutcome(102)).toMatchObject({ reason: "conflicts" });
	expect(exitCodeToOutcome(103)).toMatchObject({ reason: "failed" });
	expect(exitCodeToOutcome(9)).toMatchObject({ reason: "failed" });
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
