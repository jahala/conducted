/**
 * @feature SIDE-12 App tool: GetTerminalOutput
 * Owns: the tool that returns recent text from a terminal in the workspace.
 * Behaviour: research/conductor/claude-runner.md section 4.2: sources spotlight, run_script,
 * terminal or auto; default 1000 lines; the answer says which terminal it came from and whether it
 * still runs.
 * Must handle: auto picks the most recently active source (the app decides), no terminal at all
 * (an error result that says so), more lines asked than exist (all of them), and a very long
 * line (kept as is; the app caps the text).
 * Test first: execute() without maxLines asks the backend for 1000 lines.
 */
import { z } from "zod";
import { formatTerminalOutput } from "./format.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";

/** Lines returned when the agent does not say. From the research. */
export const DEFAULT_TERMINAL_LINES = 1000;

export const getTerminalOutputShape = {
	source: z
		.enum(["auto", "run_script", "spotlight", "terminal"])
		.optional()
		.describe("Which terminal to read. 'auto' picks the one that was active most recently."),
	maxLines: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("How many of the last lines to return."),
};

export const getTerminalOutputTool: ToolDefinition<typeof getTerminalOutputShape> = {
	name: "GetTerminalOutput",
	description:
		"Read recent output from a terminal in the user's workspace: the run script, a Spotlight session, or a terminal tab. Use it to check a dev server, a build or a test run, or when the user mentions something they see in their terminal. The reply says which terminal the text came from and whether it is still running.",
	inputShape: getTerminalOutputShape,
	readOnly: true,
	idempotent: true,
	async execute(
		args: z.infer<z.ZodObject<typeof getTerminalOutputShape>>,
		context: ToolContext,
	): Promise<ToolResult> {
		const result = await context.backend.getTerminalOutput(context.sessionId, {
			source: args.source ?? "auto",
			maxLines: args.maxLines ?? DEFAULT_TERMINAL_LINES,
		});
		if (!result.ok) return { text: result.error.message, isError: true };
		return { text: formatTerminalOutput(result.value), isError: false };
	},
};
