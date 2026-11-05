import { describe, expect, test } from "bun:test";
import { marginalCost, usageItemFromResult } from "./usage.ts";

describe("AGENT-03 Claude usage", () => {
	test("cost is the difference to the last total, and a lower total starts over", () => {
		expect(marginalCost(5.5, 5)).toBeCloseTo(0.5);
		expect(marginalCost(0.3, 5)).toBeCloseTo(0.3);
	});

	test("a result becomes a usage item with the main model's context window", () => {
		const item = usageItemFromResult(
			{
				total_cost_usd: 1.25,
				usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
				modelUsage: {
					small: { outputTokens: 2, contextWindow: 200_000 },
					main: { outputTokens: 18, contextWindow: 1_000_000 },
				},
			},
			1,
		);
		expect(item).toEqual({
			kind: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 0,
			costUsd: 0.25,
			model: "main",
			contextWindowTokens: 1_000_000,
		});
	});

	test("fast mode and the service tier come from the result usage", () => {
		const item = usageItemFromResult(
			{
				usage: { service_tier: "priority", speed: "fast" },
				modelUsage: { main: { outputTokens: 1, contextWindow: 200_000 } },
			},
			0,
		);
		expect(item.fastMode).toBe(true);
		expect(item.serviceTier).toBe("priority");
		expect(item.model).toBe("main");
	});

	test("a standard-speed result reports fast mode off", () => {
		const item = usageItemFromResult({ usage: { speed: "standard" } }, 0);
		expect(item.fastMode).toBe(false);
	});

	test("missing fields leave the optional ones out", () => {
		const item = usageItemFromResult({}, 0);
		expect(item).toEqual({
			kind: "usage",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
	});
});
