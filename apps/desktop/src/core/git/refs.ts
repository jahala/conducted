/**
 * @feature CHAT-15 Names of the private git refs
 * Owns: the ref namespace and id formats for turn checkpoints, the archive pin and Spotlight's
 * saved state, so the UI, the sidecar and bin/checkpointer.sh agree on one spelling.
 * Behaviour: services-map.md 3.12.1 to 3.12.3 (checkpoint ids and refs), 3.10 (archive pin),
 * sessions.md section 7 (turn checkpoint ids).
 * Must handle: ids are built from uuids, never from user text, so they are safe in a ref name.
 * Our design choice: the namespace is `refs/conducted/...` instead of Conductor's
 * `refs/conductor-checkpoints/...`. bin/checkpointer.sh must use the same prefix.
 * Test first: checkpointRef(turnCheckpointId("s1", "t1", "start")) is
 * "refs/conducted/checkpoints/session-s1-turn-t1-start".
 */

export const CHECKPOINT_REF_PREFIX = "refs/conducted/checkpoints/";
export const ARCHIVE_REF_PREFIX = "refs/conducted/archive/";

export type CheckpointPhase = "start" | "end";

/** Exit codes of checkpointer.sh `save`. 101 and 102 mean "skipped", not "failed". */
export const CHECKPOINTER_EXIT = {
	busy: 101,
	unmergedIndex: 102,
	notToplevel: 103,
} as const;

export const PRE_SPOTLIGHT_CHECKPOINT_ID = "pre-spotlight";
export const GET_DIFF_CHECKPOINT_ID = "get-diff";

export const turnCheckpointId = (
	sessionId: string,
	turnId: string,
	phase: CheckpointPhase,
): string => `session-${sessionId}-turn-${turnId}-${phase}`;

export const archiveCheckpointId = (workspaceId: string): string => `archive-${workspaceId}`;

/** Prefix shared by every turn checkpoint ref of one chat, start and end. */
export const sessionCheckpointRefPrefix = (sessionId: string): string =>
	`${CHECKPOINT_REF_PREFIX}session-${sessionId}-turn-`;

export const checkpointRef = (checkpointId: string): string =>
	`${CHECKPOINT_REF_PREFIX}${checkpointId}`;

/** The ref that keeps an archived workspace's last commit reachable. */
export const archiveRef = (workspaceId: string): string => `${ARCHIVE_REF_PREFIX}${workspaceId}`;
