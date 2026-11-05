import { expect, test } from "bun:test";
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { rateLimitsFromSdk } from "./usage.ts";

function response(rateLimits: unknown, available = true): SDKControlGetUsageResponse {
	return {
		rate_limits_available: available,
		rate_limits: rateLimits,
	} as SDKControlGetUsageResponse;
}

test("only a five-hour window gives that one limit with its reset in milliseconds", () => {
	const limits = rateLimitsFromSdk(
		response({ five_hour: { utilization: 42, resets_at: "2026-11-04T10:00:00Z" } }),
	);
	expect(limits).toEqual([
		{
			label: "5-hour limit",
			usedPercent: 42,
			windowMinutes: 300,
			resetsAt: Date.parse("2026-11-04T10:00:00Z"),
		},
	]);
});

test("each window reports its own reset time", () => {
	const limits = rateLimitsFromSdk(
		response({
			five_hour: { utilization: 10, resets_at: "2026-11-04T10:00:00Z" },
			seven_day: { utilization: 60, resets_at: "2026-11-09T00:00:00Z" },
		}),
	);
	expect(limits.map((l) => [l.label, l.usedPercent, l.resetsAt])).toEqual([
		["5-hour limit", 10, Date.parse("2026-11-04T10:00:00Z")],
		["Weekly limit", 60, Date.parse("2026-11-09T00:00:00Z")],
	]);
});

test("null utilization and unavailable limits give no limits", () => {
	expect(
		rateLimitsFromSdk(response({ five_hour: { utilization: null, resets_at: null } })),
	).toEqual([]);
	expect(rateLimitsFromSdk(response(null, false))).toEqual([]);
});
