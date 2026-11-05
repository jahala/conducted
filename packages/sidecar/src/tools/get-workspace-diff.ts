/**
 * @feature SIDE-12 App tool: GetWorkspaceDiff
 * Owns: the tool that returns the same diff the user sees in the Changes tab.
 * Behaviour: research/conductor/claude-runner.md section 4.2: all changes on the branch, including
 * uncommitted ones, against the merge base with the target branch; an optional file filter and a
 * stat-only mode; 20 s timeout; the text "No changes found." when the diff is empty.
 * Must handle: a file path that is absolute or relative to the workspace, a diff larger than the
 * model needs (returned as is up to the app's own cap; the tool does not cut it), an app timeout
 * (error result with the reason), and statOnly true (file list with counts, no hunks).
 * Test first: execute() with an empty diff returns "No changes found." with isError false.
 */
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";

export const getWorkspaceDiffShape = {
	file: z
		.string()
		.optional()
		.describe("Limit the diff to one file. An absolute path or one relative to the workspace."),
	stat: z
		.boolean()
		.optional()
		.describe("True to get only the list of changed files with line counts."),
};

export const getWorkspaceDiffTool: ToolDefinition<typeof getWorkspaceDiffShape> = {
	name: "GetWorkspaceDiff",
	description:
		"Get the diff of this workspace as the user sees it in the Changes tab: every change on the branch, committed or not, compared with the point where it left the target branch. Use it when the user talks about 'the diff', 'my changes' or 'the PR', or when you need to review your own work. Pass `file` for one file, or `stat` for a summary.",
	inputShape: getWorkspaceDiffShape,
	readOnly: true,
	idempotent: true,
	async execute(
		args: z.infer<z.ZodObject<typeof getWorkspaceDiffShape>>,
		context: ToolContext,
	): Promise<ToolResult> {
		const result = await context.backend.getWorkspaceDiff(context.sessionId, {
			file: args.file,
			statOnly: args.stat ?? false,
		});
		if (!result.ok) {
			if (result.error.code === "git_busy") {
				return {
					text: "Cannot fetch diff: merge or rebase in progress.",
					isError: true,
				};
			}
			return { text: result.error.message, isError: true };
		}
		return result.value.trim() === ""
			? { text: "No changes found.", isError: false }
			: { text: result.value, isError: false };
	},
};
