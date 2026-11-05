/**
 * @feature AGENT-07 Codex: native item to canonical tool table
 * Owns: the table from Codex thread item types to our canonical tools, and the usage conversion.
 * Behaviour: research/conductor/other-runners.md section 3; item names from the generated bindings
 * of codex-cli 0.154.0 (see translate.ts).
 * Must handle: an item type that is not a tool (absent from the table), an MCP call to our own
 * server (app_tool, decided from the server name), and token usage with a null context window
 * (the window is left out).
 * Test first: toolForCodexItem("commandExecution", undefined) is "bash" and
 * toolForCodexItem("mcpToolCall", "conducted") is "app_tool".
 */
import { type AgentItem, APP_TOOL_SERVER, type CanonicalTool } from "@conducted/protocol";
import type { CodexThreadTokenUsage } from "./protocol.ts";

export const CODEX_ITEM_TOOLS: Readonly<Record<string, CanonicalTool>> = {
	commandExecution: "bash",
	fileChange: "edit",
	mcpToolCall: "mcp",
	dynamicToolCall: "mcp",
	collabAgentToolCall: "sub_agent",
	webSearch: "web_search",
	imageView: "image_view",
	imageGeneration: "image_generation",
};

export function toolForCodexItem(
	itemType: string,
	mcpServer: string | undefined,
): CanonicalTool | null {
	if (itemType === "mcpToolCall" && mcpServer === APP_TOOL_SERVER) return "app_tool";
	return CODEX_ITEM_TOOLS[itemType] ?? null;
}

/** The usage item for a tokenUsage notification: the last turn's counts and the window. */
export function codexUsageItem(
	usage: CodexThreadTokenUsage,
): Extract<AgentItem, { kind: "usage" }> {
	const item: Extract<AgentItem, { kind: "usage" }> = {
		kind: "usage",
		inputTokens: usage.last.inputTokens,
		outputTokens: usage.last.outputTokens,
		cacheReadTokens: usage.last.cachedInputTokens,
		cacheWriteTokens: usage.last.cacheWriteInputTokens,
	};
	if (usage.modelContextWindow !== null && usage.modelContextWindow > 0) {
		item.contextWindowTokens = usage.modelContextWindow;
	}
	return item;
}
