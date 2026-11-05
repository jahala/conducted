/**
 * @feature AGENT-03 Claude: usage and cost from result messages
 * Owns: turning a Claude result message into a neutral usage item, and computing the cost of one
 * turn from the process's running total.
 * Behaviour: research/conductor/claude-runner.md section 2 "result handling" (the SDK reports a
 * cumulative cost per process, so the cost of a turn is the total minus the last reported total,
 * never below zero; fast mode, the service tier and the speed are on the result's usage) and
 * section 7 (cost per turn, context window).
 * Must handle: a total that went down (a restarted process: treat the new total as the turn's
 * cost), missing fields (the item is still produced, optional fields left out), several models in
 * modelUsage (the model that handled most output tokens names the item and gives the context
 * window), and a result with is_error (usage is still reported).
 * Test first: marginalCost(5.5, 5) is 0.5; marginalCost(0.3, 5) is 0.3.
 * Our design choice: the neutral usage item has no speed field, so `speed` stays in the message's
 * raw payload. Fast mode is true when the usage says the request ran at fast speed.
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
		service_tier?: string;
		speed?: string;
	};
	modelUsage?: Record<string, { outputTokens?: number; contextWindow?: number }>;
	fast_mode_state?: string;
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
	const main = mainModelUsage(result.modelUsage);
	if (main?.contextWindow !== undefined) item.contextWindowTokens = main.contextWindow;
	if (main !== undefined) item.model = main.model;
	if (usage.speed !== undefined || result.fast_mode_state !== undefined) {
		item.fastMode = usage.speed === "fast" || result.fast_mode_state === "on";
	}
	if (typeof usage.service_tier === "string" && usage.service_tier !== "") {
		item.serviceTier = usage.service_tier;
	}
	return item;
}

interface MainModel {
	model: string;
	contextWindow?: number;
}

/** The model that produced the most output tokens, so a helper model does not name the turn. */
function mainModelUsage(modelUsage: ClaudeResultUsage["modelUsage"]): MainModel | undefined {
	if (!modelUsage) return undefined;
	let best: { model: string; output: number; window?: number } | undefined;
	for (const [model, entry] of Object.entries(modelUsage)) {
		const output = entry.outputTokens ?? 0;
		if (
			best === undefined ||
			output > best.output ||
			(output === best.output && model < best.model)
		) {
			const window =
				entry.contextWindow !== undefined && entry.contextWindow > 0
					? entry.contextWindow
					: undefined;
			best = { model, output, window };
		}
	}
	if (best === undefined) return undefined;
	return best.window === undefined
		? { model: best.model }
		: { model: best.model, contextWindow: best.window };
}
