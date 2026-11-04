/**
 * @feature AGENT-03 Claude: usage and cost from result messages
 * Owns: turning a Claude result message into a neutral usage item, and computing the cost of one
 * turn from the process's running total.
 * Behaviour: research/conductor/claude-runner.md section 2 "result handling" (the SDK reports a
 * cumulative cost per process, so the cost of a turn is the total minus the last reported total,
 * never below zero) and section 7 (cost per turn, context window).
 * Must handle: a total that went down (a restarted process: treat the new total as the turn's
 * cost), missing fields (the item is still produced, optional fields left out), several models in
 * modelUsage (the context window of the model that handled most output tokens), and a result with
 * is_error (usage is still reported).
 * Test first: marginalCost(5.5, 5) is 0.5; marginalCost(0.3, 5) is 0.3.
 */
import type { AgentItem } from "@conducted/protocol";

export function marginalCost(totalCostUsd: number, lastReportedUsd: number): number {
	if (totalCostUsd < lastReportedUsd) return Math.max(0, totalCostUsd);
	return Math.max(0, totalCostUsd - lastReportedUsd);
}

/** The fields of a result message that this file reads. A narrow view of the SDK type. */
export interface ClaudeResultUsage {
	total_cost_usd?: number;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	};
	modelUsage?: Record<string, { outputTokens?: number; contextWindow?: number }>;
}

export function usageItemFromResult(
	result: ClaudeResultUsage,
	lastReportedCostUsd: number,
): Extract<AgentItem, { kind: "usage" }> {
	const usage = result.usage ?? {};
	const item: Extract<AgentItem, { kind: "usage" }> = {
		kind: "usage",
		inputTokens: usage.input_tokens ?? 0,
		outputTokens: usage.output_tokens ?? 0,
		cacheReadTokens: usage.cache_read_input_tokens ?? 0,
		cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
	};
	if (result.total_cost_usd !== undefined) {
		item.costUsd = marginalCost(result.total_cost_usd, lastReportedCostUsd);
	}
	const window = contextWindowOfMainModel(result.modelUsage);
	if (window !== undefined) item.contextWindowTokens = window;
	return item;
}

function contextWindowOfMainModel(modelUsage: ClaudeResultUsage["modelUsage"]): number | undefined {
	if (!modelUsage) return undefined;
	let best: { output: number; window: number } | undefined;
	for (const entry of Object.values(modelUsage)) {
		if (entry.contextWindow === undefined || entry.contextWindow <= 0) continue;
		const output = entry.outputTokens ?? 0;
		if (!best || output > best.output) best = { output, window: entry.contextWindow };
	}
	return best?.window;
}
