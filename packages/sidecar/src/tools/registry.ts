/**
 * @feature SIDE-12 App tools: registry
 * Owns: the list of all app tools, and which of them a chat gets.
 * Behaviour: research/conductor/claude-runner.md section 4.1 "Tool availability flags": the config
 * switches decide which tools exist; a change of the switches restarts the agent (policy
 * "recreate" in the Claude config table), because the tool list is fixed at start.
 * Must handle: the registry has exactly one definition for every name in APP_TOOLS (the type
 * enforces it), the bridge-only list leaves out AskUserQuestion (Codex and ACP agents have their
 * own question mechanism), and a switch that is off removes the tool from the list.
 * Test first: with progressUpdates false the list has no UpdateProgress; with all switches on it
 * has every tool of APP_TOOLS.
 */
import { APP_TOOLS, type AppTool, type SessionConfig } from "@conducted/protocol";
import { askUserQuestion } from "./ask-user-question.ts";
import { diffCommentTool } from "./diff-comment.ts";
import { getDiffCommentsTool } from "./get-diff-comments.ts";
import { getTerminalOutputTool } from "./get-terminal-output.ts";
import { getWorkspaceDiffTool } from "./get-workspace-diff.ts";
import { setTargetBranchTool } from "./set-target-branch.ts";
import type { ToolDefinition, ToolShape } from "./types.ts";
import { updateProgressTool } from "./update-progress.ts";

type AnyTool = ToolDefinition<ToolShape>;

export const APP_TOOL_DEFINITIONS: Record<AppTool, AnyTool> = {
	AskUserQuestion: askUserQuestion as unknown as AnyTool,
	GetWorkspaceDiff: getWorkspaceDiffTool as unknown as AnyTool,
	GetDiffComments: getDiffCommentsTool as unknown as AnyTool,
	DiffComment: diffCommentTool as unknown as AnyTool,
	GetTerminalOutput: getTerminalOutputTool as unknown as AnyTool,
	UpdateProgress: updateProgressTool as unknown as AnyTool,
	SetTargetBranch: setTargetBranchTool as unknown as AnyTool,
};

/** The tools a chat gets, in the order of APP_TOOLS. */
export function enabledTools(
	switches: SessionConfig["appTools"],
	options: { includeAskUserQuestion: boolean },
): AnyTool[] {
	return APP_TOOLS.map((name) => APP_TOOL_DEFINITIONS[name]).filter((tool) => {
		if (tool.name === "AskUserQuestion" && !options.includeAskUserQuestion) return false;
		return tool.enabledBy === undefined || switches[tool.enabledBy];
	});
}
