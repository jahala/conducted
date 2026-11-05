/**
 * @feature SIDE-12 App tool: UpdateProgress
 * Owns: the tool that fills the progress tracker above the composer.
 * Behaviour: research/conductor/claude-runner.md sections 4.2 and 5 item 1: a title and blocks
 * (bars, steps, text); each call replaces the previous one, so the agent always sends the whole
 * picture; an empty block list clears the tracker; only offered when the progressUpdates switch is
 * on, and then prompt/system-additions.ts tells the agent when to use it. The shape lives in
 * @conducted/protocol (progress.ts).
 * Must handle: an empty block list (clears), more blocks or steps than the protocol allows
 * (refused by the schema; a tracker with more is noise), the app not connected (the call still
 * succeeds, see AppToolBackend), and the status "failed" (shown, not an error of the tool).
 * Test first: execute() with an empty block list sends a progress update with no blocks and
 * answers "Progress cleared."
 */
import { zProgress } from "@conducted/protocol";
import type { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";

export const updateProgressShape = {
	title: zProgress.shape.title.describe("A short name for the work, such as 'Migrating the API'."),
	blocks: zProgress.shape.blocks.describe(
		"The full tracker: bars (label, value, max), step lists (label and status) and short text. Send an empty list when the work is finished or dropped.",
	),
};

export const updateProgressTool: ToolDefinition<typeof updateProgressShape> = {
	name: "UpdateProgress",
	description:
		"Show the user a progress tracker above the chat box for long, multi-step work. Send the full current state each time, because every call replaces the last one. Use a few blocks: a list of steps with short labels moving from pending to in_progress to done, a bar for countable work, or a line of text. Send an empty list when you are finished. Skip it for quick tasks.",
	inputShape: updateProgressShape,
	readOnly: false,
	idempotent: true,
	alwaysLoad: true,
	enabledBy: "progressUpdates",
	async execute(
		args: z.infer<z.ZodObject<typeof updateProgressShape>>,
		context: ToolContext,
	): Promise<ToolResult> {
		context.backend.updateProgress(context.sessionId, {
			title: args.title,
			blocks: args.blocks,
		});
		return {
			text: args.blocks.length === 0 ? "Progress cleared." : "Progress updated.",
			isError: false,
		};
	},
};
