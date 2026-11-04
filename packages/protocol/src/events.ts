/**
 * The durable events of a chat, in the order they happened. The UI stores each one in the
 * `session_events` table (idempotent on eventId) and then acknowledges it, and the sidecar keeps
 * it in its write-ahead log until that acknowledgement.
 * Research: sessions.md section 5, sessions-and-chats.md "How chats are stored".
 * Our design choices: one log instead of two, and an explicit turnEnded event so a turn cut off
 * by a crash can be found and closed at startup.
 */
import { z } from "zod";
import { zAgentMessage } from "./agent-message.ts";
import { zCheckpointId, zEventId, zMessageId, zTurnId } from "./ids.ts";
import { zSessionConfig } from "./session-config.ts";

export const zFileChange = z.object({
	path: z.string(),
	oldPath: z.string().optional(),
	status: z.enum(["added", "modified", "deleted", "renamed", "copied"]),
	linesAdded: z.number().int().nonnegative(),
	linesRemoved: z.number().int().nonnegative(),
	binary: z.boolean(),
});
export type FileChange = z.infer<typeof zFileChange>;

const base = { eventId: zEventId, at: z.number() };

export const zUserMessageEvent = z.object({
	...base,
	type: z.literal("user_message"),
	messageId: zMessageId,
	turnId: zTurnId,
	/** The text the user typed, before the sidecar adds instructions or expands mentions. */
	text: z.string(),
	attachmentPaths: z.array(z.string()),
	delivery: z.enum(["new_turn", "steer"]),
	config: zSessionConfig,
});

export const zAgentEvent = z.object({
	...base,
	type: z.literal("agent"),
	turnId: zTurnId,
	message: zAgentMessage,
});

export const zCheckpointEvent = z.object({
	...base,
	type: z.literal("checkpoint"),
	turnId: zTurnId,
	phase: z.enum(["start", "end"]),
	/** Missing when the snapshot was skipped (merge or rebase in progress, conflicts) or failed. */
	checkpointId: zCheckpointId.optional(),
	skippedReason: z.enum(["merge_in_progress", "conflicts", "failed"]).optional(),
	/** End checkpoints only: files changed during the turn, omitted above 200 files. */
	changes: z.array(zFileChange).optional(),
});

export const zTurnEndedEvent = z.object({
	...base,
	type: z.literal("turn_ended"),
	turnId: zTurnId,
	outcome: z.enum(["success", "error", "cancelled", "interrupted"]),
	error: z.string().optional(),
});

export const zSessionEvent = z.discriminatedUnion("type", [
	zUserMessageEvent,
	zAgentEvent,
	zCheckpointEvent,
	zTurnEndedEvent,
]);
export type SessionEvent = z.infer<typeof zSessionEvent>;
export type SessionEventType = SessionEvent["type"];
