/**
 * @feature SIDE-12 App tool: DiffComment
 * Owns: the tool that lets an agent leave review comments on the diff.
 * Behaviour: research/conductor/claude-runner.md section 4.2: each comment names a file and a
 * line; comments land in the Changes tab, not on GitHub, unless the user asks for GitHub; the
 * answer says how many were posted.
 * Must handle: at least one comment (schema), a file that is not in the diff (the app decides;
 * the error text comes back to the agent), an end line before the start line (refused by the
 * schema check in execute), and plain text bodies (no markdown is required).
 * Test first: execute() with two comments calls addDiffComments once and answers "Posted 2
 * comments on the diff."
 */
import { z } from "zod";
import type { DiffCommentInput, ToolContext, ToolDefinition, ToolResult } from "./types.ts";

export const diffCommentShape = {
	comments: z
		.array(
			z.object({
				file: z.string().describe("The path of the file, relative to the workspace."),
				lineNumber: z.number().int().positive().describe("The line the comment is about."),
				endLine: z.number().int().positive().optional().describe("The last line, for a range."),
				body: z.string().describe("The comment. Plain text reads best."),
			}),
		)
		.min(1),
};

export const diffCommentTool: ToolDefinition<typeof diffCommentShape> = {
	name: "DiffComment",
	description:
		"Leave review comments on the user's diff, each on a file and line. They appear in the Changes tab. Prefer this over posting to GitHub unless the user asks for GitHub. Keep each comment short and specific.",
	inputShape: diffCommentShape,
	readOnly: false,
	idempotent: false,
	async execute(
		args: z.infer<z.ZodObject<typeof diffCommentShape>>,
		context: ToolContext,
	): Promise<ToolResult> {
		const invalid = args.comments.find(
			(comment) => comment.endLine !== undefined && comment.endLine < comment.lineNumber,
		);
		if (invalid !== undefined) {
			return {
				text: `The comment on ${invalid.file} ends at line ${invalid.endLine}, before it starts at line ${invalid.lineNumber}.`,
				isError: true,
			};
		}
		const comments: DiffCommentInput[] = args.comments.map((comment) => ({
			file: comment.file,
			line: comment.lineNumber,
			endLine: comment.endLine,
			body: comment.body,
		}));
		const result = await context.backend.addDiffComments(context.sessionId, comments);
		if (!result.ok) return { text: result.error.message, isError: true };
		const noun = result.value === 1 ? "comment" : "comments";
		return { text: `Posted ${result.value} ${noun} on the diff.`, isError: false };
	},
};
