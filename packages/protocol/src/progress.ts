/**
 * The progress tracker an agent fills through its UpdateProgress tool, shown above the composer.
 * One home for the shape: the sidecar's tool input, the progress notification and the chat view
 * all use it. Each update replaces the previous one; an empty block list clears the tracker.
 * Research: claude-runner.md section 4.2 (a title and blocks: bars, steps and text).
 */
import { z } from "zod";

export const MAX_PROGRESS_BLOCKS = 6;
export const MAX_PROGRESS_STEPS = 12;

export const zProgressStepStatus = z.enum(["pending", "in_progress", "done", "failed"]);
export type ProgressStepStatus = z.infer<typeof zProgressStepStatus>;

export const zProgressBlock = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("bar"),
		label: z.string(),
		/** How far along the bar is. Without it the bar has no known position. */
		value: z.number().nonnegative().optional(),
		/** The value that means done. Without it the bar has no known end. */
		max: z.number().positive().optional(),
		detail: z.string().optional(),
	}),
	z.object({
		kind: z.literal("steps"),
		steps: z
			.array(z.object({ label: z.string(), status: zProgressStepStatus }))
			.max(MAX_PROGRESS_STEPS),
	}),
	z.object({ kind: z.literal("text"), text: z.string() }),
]);
export type ProgressBlock = z.infer<typeof zProgressBlock>;

export const zProgress = z.object({
	title: z.string().optional(),
	blocks: z.array(zProgressBlock).max(MAX_PROGRESS_BLOCKS),
});
export type Progress = z.infer<typeof zProgress>;
