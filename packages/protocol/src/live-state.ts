/**
 * A chat's live state. Status is only idle or working; everything else is a separate flag.
 * The sidecar reports "idle" only after the turn's last event has been sent.
 * Research: sessions.md section 2 "Status and state literals".
 */
import { z } from "zod";
import { zInteractionId, zMessageId } from "./ids.ts";
import { zInteraction } from "./interactions.ts";

export const zSessionStatus = z.enum(["idle", "working"]);
export type SessionStatus = z.infer<typeof zSessionStatus>;

export const zBackgroundTask = z.object({
	id: z.string(),
	kind: z.enum(["sub_agent", "shell", "other"]),
	description: z.string(),
});

export const zLiveState = z.object({
	status: zSessionStatus,
	/** Plain-language error from the last turn, cleared when a new turn starts. */
	error: z.string().optional(),
	/** Steer messages sent but not yet read by the agent. */
	pendingSteerIds: z.array(zMessageId),
	backgroundTasks: z.array(zBackgroundTask),
	/** The open interaction, if the agent is waiting for the user. */
	openInteraction: z
		.object({ interactionId: zInteractionId, interaction: zInteraction, since: z.number() })
		.optional(),
	/** False after the provider refused fast mode for this account. */
	fastModeAvailable: z.boolean(),
	/**
	 * Set while the turn waits on a blocking read of a background task's output, in milliseconds
	 * since the epoch. The chat shows how long it has waited.
	 */
	waitingSince: z.number().optional(),
	/**
	 * Set while the agent retries a failed request by itself, for the "retrying n of m" line.
	 * Cleared when the retry succeeds or the turn ends.
	 */
	retry: z
		.object({
			attempt: z.number().int().positive(),
			maxAttempts: z.number().int().positive(),
			/** When the next attempt starts, in milliseconds since the epoch, when the agent says. */
			nextAttemptAt: z.number().optional(),
			/** The error that caused the retry, in plain words. */
			error: z.string().optional(),
		})
		.optional(),
});
export type LiveState = z.infer<typeof zLiveState>;

export const idleLiveState: LiveState = {
	status: "idle",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
};
