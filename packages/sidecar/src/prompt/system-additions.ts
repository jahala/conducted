/**
 * @feature SIDE-09 Prompt assembly: system prompt additions
 * Owns: the short guidance appended to the agent's system prompt (Claude) or to the first message
 * (other agents) when an app tool needs the agent to know when to use it.
 * Behaviour: research/conductor/claude-runner.md section 5 item 1: only the progress tracker adds
 * to the system prompt; everything else goes into the first user message. The wording is ours.
 * Must handle: the guidance exists only when progressUpdates is on, and it names the tool as the
 * agent sees it (the MCP prefix differs per agent, so the caller passes the full tool name).
 * Test first: progressTrackerGuidance("mcp__conducted__UpdateProgress") contains that tool name.
 */
export function progressTrackerGuidance(toolName: string): string {
	return [
		"Conducted can show the user a progress tracker above the chat box.",
		`During long work with several stages, keep it current with the ${toolName} tool: three to six stages with labels of one to three words, moved from pending to in_progress to done as you go.`,
		"Do not use it for quick tasks.",
	].join(" ");
}
