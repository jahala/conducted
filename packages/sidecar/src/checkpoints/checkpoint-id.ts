/**
 * @feature SIDE-08 Checkpoints: ids, ref names and exit codes
 * Owns: the checkpoint id format, the private git ref it is stored under, and the meaning of the
 * exit codes of bin/checkpointer.sh.
 * Behaviour: research/conductor/sessions.md section 7 (id session-<sessionId>-turn-<turnId>-<start
 * or end>; exit 0 created, 101 skipped for a merge or rebase, 102 skipped for conflicts, other
 * codes are failures) and native-and-sidecar-map.md C1 (exit 103 refuses when the repo root is an
 * ancestor of the cwd).
 * Must handle: an unknown exit code (a failure, with the code in the message), 143 (terminated by
 * our own timeout), and ids with characters git refs do not allow (ids are UUIDs, so the id is
 * checked and refused otherwise instead of being sanitised).
 * Test first: exitCodeToOutcome(101) is skipped with reason merge_in_progress.
 * Our design choice: the ref lives under refs/conducted/checkpoints/<id>, our own namespace.
 */
import type { zCheckpointEvent } from "@conducted/protocol";
import type { CheckpointId, SessionId, TurnId } from "@conducted/shared";
import type { z } from "zod";

export type CheckpointPhase = "start" | "end";

export const CHECKPOINT_REF_PREFIX = "refs/conducted/checkpoints/";

/** The exit codes of bin/checkpointer.sh. Keep in sync with the header of that script. */
export const CHECKPOINTER_EXIT = {
	ok: 0,
	error: 1,
	skippedMergeOrRebase: 101,
	skippedConflicts: 102,
	refusedRootIsAncestor: 103,
	terminated: 143,
} as const;

const SAFE_PART = /^[A-Za-z0-9._-]+$/;

/** Git refuses ".." anywhere in a ref name, so a part with it is refused here, not by the script. */
function isSafePart(part: string): boolean {
	return SAFE_PART.test(part) && !part.includes("..");
}

export function checkpointIdFor(
	sessionId: SessionId,
	turnId: TurnId,
	phase: CheckpointPhase,
): CheckpointId | null {
	if (!isSafePart(sessionId) || !isSafePart(turnId)) return null;
	return `session-${sessionId}-turn-${turnId}-${phase}` as CheckpointId;
}

export function checkpointRefFor(id: CheckpointId): string {
	return `${CHECKPOINT_REF_PREFIX}${id}`;
}

/** The protocol's checkpoint reason is the one home for this list. */
export type SkipReason = NonNullable<z.infer<typeof zCheckpointEvent>["skippedReason"]>;

export type ExitOutcome =
	| { kind: "created" }
	| { kind: "skipped"; reason: SkipReason; detail: string };

export function exitCodeToOutcome(code: number): ExitOutcome {
	switch (code) {
		case CHECKPOINTER_EXIT.ok:
			return { kind: "created" };
		case CHECKPOINTER_EXIT.skippedMergeOrRebase:
			return {
				kind: "skipped",
				reason: "merge_in_progress",
				detail: "A merge or rebase is running",
			};
		case CHECKPOINTER_EXIT.skippedConflicts:
			return { kind: "skipped", reason: "conflicts", detail: "The index has unresolved conflicts" };
		case CHECKPOINTER_EXIT.refusedRootIsAncestor:
			return {
				kind: "skipped",
				reason: "failed",
				detail: "The git root is not the workspace folder, so the checkpointer refused",
			};
		case CHECKPOINTER_EXIT.terminated:
			return {
				kind: "skipped",
				reason: "failed",
				detail: "The checkpointer timed out and was stopped",
			};
		default:
			return {
				kind: "skipped",
				reason: "failed",
				detail: `The checkpointer exited with code ${code}`,
			};
	}
}
