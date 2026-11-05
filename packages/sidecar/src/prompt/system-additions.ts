/**
 * @feature SIDE-09 Prompt assembly: system prompt additions
 * Owns: the short guidance appended to the agent's system prompt (Claude) or to the first message
 * (other agents) when an app tool needs the agent to know when to use it, and the Claude system
 * prompt shape that carries it.
 * Behaviour: research/conductor/claude-runner.md sections 1.2 and 5 item 1: the system prompt is
 * the stock `claude_code` preset plus the progress tracker paragraph, and nothing else. The
 * wording is ours.
 * Must handle: the guidance exists only when progressUpdates is on, and it names the tool as the
 * agent sees it (the MCP prefix differs per agent, so the caller passes the full tool name).
 * Test first: progressTrackerGuidance("mcp__conducted__UpdateProgress") contains that tool name.
 */
export const CLAUDE_SYSTEM_PROMPT_PRESET = "claude_code";

export interface ClaudeSystemPrompt {
	type: "preset";
	preset: typeof CLAUDE_SYSTEM_PROMPT_PRESET;
	append?: string;
}

export function progressTrackerGuidance(toolName: string): string {
	return [
		"Conducted can show the user a progress tracker above the chat box.",
		`During long work with several stages, keep it current with the ${toolName} tool: three to six stages with labels of one to three words, moved from pending to in_progress to done as you go.`,
		"Do not use it for quick tasks.",
	].join(" ");
}

/** The Claude preset, with the tracker paragraph only while the progress switch is on. */
export function buildClaudeSystemPrompt(
	progressUpdates: boolean,
	progressToolName: string,
): ClaudeSystemPrompt {
	const prompt: ClaudeSystemPrompt = {
		type: "preset",
		preset: CLAUDE_SYSTEM_PROMPT_PRESET,
	};
	if (progressUpdates) prompt.append = progressTrackerGuidance(progressToolName);
	return prompt;
}
