import { expect, test } from "bun:test";
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { planUsageFromSdk } from "./usage.ts";

function response(rateLimits: unknown, available = true): SDKControlGetUsageResponse {
	return {
		rate_limits_available: available,
		rate_limits: rateLimits,
	} as SDKControlGetUsageResponse;
}

test("only a five-hour window gives that percentage and its reset in milliseconds", () => {
	const plan = planUsageFromSdk(
		response({ five_hour: { utilization: 42, resets_at: "2026-11-04T10:00:00Z" } }),
	);
	expect(plan).toEqual({
		fiveHourUsedPercent: 42,
		fiveHourResetsAt: Date.parse("2026-11-04T10:00:00Z"),
	});
});

test("each window reports its own reset time", () => {
	const plan = planUsageFromSdk(
		response({
			five_hour: { utilization: 10, resets_at: "2026-11-04T10:00:00Z" },
			seven_day: { utilization: 60, resets_at: "2026-11-09T00:00:00Z" },
		}),
	);
	expect(plan).toEqual({
		fiveHourUsedPercent: 10,
		fiveHourResetsAt: Date.parse("2026-11-04T10:00:00Z"),
		sevenDayUsedPercent: 60,
		sevenDayResetsAt: Date.parse("2026-11-09T00:00:00Z"),
	});
});

test("null utilization and unavailable limits give no plan", () => {
	expect(
		planUsageFromSdk(response({ five_hour: { utilization: null, resets_at: null } })),
	).toBeUndefined();
	expect(planUsageFromSdk(response(null, false))).toBeUndefined();
});
