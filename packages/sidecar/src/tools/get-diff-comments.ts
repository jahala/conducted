/**
 * @feature SIDE-12 App tool: GetDiffComments
 * Owns: the tool that lists the review comments on the diff.
 * Behaviour: research/conductor/claude-runner.md section 4.2: the same comments the Changes tab
 * shows, whoever wrote them (the user, an agent, GitHub); reading does not resolve anything; only
 * offered when the diffComments switch is on.
 * Must handle: no comments (a plain sentence), a comment without a line (the contract requires a
 * line, so none occur), a file filter that matches nothing, and resolved comments (marked, not
 * hidden).
 * Test first: execute() with two comments returns them through formatDiffComments.
 */
import { z } from "zod";
import { formatDiffComments } from "./format.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";

export const getDiffCommentsShape = {
	file: z.string().optional().describe("Only the comments on this file."),
};

export const getDiffCommentsTool: ToolDefinition<typeof getDiffCommentsShape> = {
	name: "GetDiffComments",
	description:
		"Read the review comments on this workspace's diff, including those from the user, from other agents and from GitHub. Use it when the user asks you to address or look at their comments. Reading does not resolve or change them.",
	inputShape: getDiffCommentsShape,
	readOnly: true,
	idempotent: true,
	enabledBy: "diffComments",
	async execute(
		args: z.infer<z.ZodObject<typeof getDiffCommentsShape>>,
		context: ToolContext,
	): Promise<ToolResult> {
		const result = await context.backend.getDiffComments(context.sessionId, {
			file: args.file,
		});
		if (!result.ok) return { text: result.error.message, isError: true };
		return { text: formatDiffComments(result.value), isError: false };
	},
};
