import { z } from "zod";
import { zInteractionId, zMessageId } from "./ids.ts";
import { zInteraction } from "./interactions.ts";

/**
 * A chat's live state. Status is only idle or working; everything else is a separate flag.
 * The sidecar reports "idle" only after the turn's last event has been sent.
 * Research: sessions.md section 2 "Status and state literals".
 */
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
});
export type LiveState = z.infer<typeof zLiveState>;

export const idleLiveState: LiveState = {
	status: "idle",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
};
