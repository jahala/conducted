import { expect, test } from "bun:test";
import { codexUsageItem, toolForCodexItem } from "./tool-names.ts";

test("items map to tools, and our own MCP server maps to app_tool", () => {
	expect(toolForCodexItem("commandExecution", undefined)).toBe("bash");
	expect(toolForCodexItem("mcpToolCall", "conducted")).toBe("app_tool");
	expect(toolForCodexItem("mcpToolCall", "linear")).toBe("mcp");
	expect(toolForCodexItem("agentMessage", undefined)).toBeNull();
});

test("usage uses the last turn's counts and drops a null window", () => {
	const breakdown = {
		totalTokens: 0,
		inputTokens: 100,
		cachedInputTokens: 40,
		cacheWriteInputTokens: 2,
		outputTokens: 30,
		reasoningOutputTokens: 5,
	};
	const usage = {
		total: { ...breakdown, inputTokens: 900 },
		last: breakdown,
		modelContextWindow: null,
	};
	expect(codexUsageItem(usage)).toEqual({
		kind: "usage",
		inputTokens: 100,
		outputTokens: 30,
		cacheReadTokens: 40,
		cacheWriteTokens: 2,
	});
	expect(codexUsageItem({ ...usage, modelContextWindow: 258000 }).contextWindowTokens).toBe(258000);
});
