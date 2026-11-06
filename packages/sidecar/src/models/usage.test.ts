import { describe, expect, test } from "bun:test";
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { RateLimit } from "@conducted/protocol";
import { type SessionId, systemClock } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import {
	PLAN_USAGE_TIMEOUT_MS,
	rateLimitsFromSdk,
	SessionUsageReader,
	type UsageSessionSource,
} from "./usage.ts";

function response(rateLimits: unknown, available = true): SDKControlGetUsageResponse {
	return {
		rate_limits_available: available,
		rate_limits: rateLimits,
	} as SDKControlGetUsageResponse;
}

function testLogger(): { logger: ReturnType<typeof createLogger>; records: LogRecord[] } {
	const records: LogRecord[] = [];
	const instance = createLogger({
		sink: (record) => records.push(record),
		clock: systemClock,
		level: "debug",
		scope: "models:usage",
	});
	return { logger: instance, records };
}

const sessionId = "session-1" as SessionId;

describe("SIDE-17 rate limits from the Claude SDK", () => {
	test("SIDE-17 only a five-hour window gives that one limit with its reset in milliseconds", () => {
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

	test("SIDE-17 each window reports its own reset time", () => {
		const limits = rateLimitsFromSdk(
			response({
				five_hour: { utilization: 10, resets_at: "2026-11-04T10:00:00Z" },
				seven_day: { utilization: 60, resets_at: "2026-11-09T00:00:00Z" },
			}),
		);
		expect(limits.map((limit) => [limit.label, limit.usedPercent, limit.resetsAt])).toEqual([
			["5-hour limit", 10, Date.parse("2026-11-04T10:00:00Z")],
			["7-day limit", 60, Date.parse("2026-11-09T00:00:00Z")],
		]);
	});

	test("SIDE-17 null utilization and unavailable limits give no limits", () => {
		expect(
			rateLimitsFromSdk(response({ five_hour: { utilization: null, resets_at: null } })),
		).toEqual([]);
		expect(rateLimitsFromSdk(response(null, false))).toEqual([]);
	});

	test("SIDE-17 an unreadable reset time is left out, not reported as zero", () => {
		const limits = rateLimitsFromSdk(
			response({ five_hour: { utilization: 5, resets_at: "not a date" } }),
		);
		expect(limits).toEqual([{ label: "5-hour limit", usedPercent: 5, windowMinutes: 300 }]);
	});
});

describe("SIDE-17 context usage of a chat", () => {
	test("SIDE-17 the used and total tokens of the live query are returned", async () => {
		const { logger } = testLogger();
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: true,
				agent: {
					contextUsage: async () => ({ usedTokens: 1234, windowTokens: 200_000 }),
				},
			}),
		};
		const reader = new SessionUsageReader({ logger, sessions: source });

		expect(await reader.contextUsage(sessionId)).toEqual({
			ok: true,
			value: { usedTokens: 1234, windowTokens: 200_000, rateLimits: [] },
		});
	});

	test("SIDE-17 an unknown session is a session_unknown error", async () => {
		const { logger } = testLogger();
		const source: UsageSessionSource = { find: () => undefined };
		const reader = new SessionUsageReader({ logger, sessions: source });

		const result = await reader.contextUsage(sessionId);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("session_unknown");
	});

	test("SIDE-17 a known chat with no live agent is an error, never zero", async () => {
		const { logger } = testLogger();
		const source: UsageSessionSource = {
			find: () => ({ agent: null, contextUsage: false }),
		};
		const reader = new SessionUsageReader({ logger, sessions: source });

		const result = await reader.contextUsage(sessionId);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("context_usage_unavailable");
	});

	test("SIDE-17 an agent without context usage is an error, never zero", async () => {
		const { logger } = testLogger();
		let asked = false;
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: false,
				agent: {
					contextUsage: async () => {
						asked = true;
						return { usedTokens: 0, windowTokens: 200_000 };
					},
				},
			}),
		};
		const reader = new SessionUsageReader({ logger, sessions: source });

		const result = await reader.contextUsage(sessionId);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("context_usage_unavailable");
		expect(asked).toBe(false);
	});

	test("SIDE-17 a chat that has not reported its window is an error, never zero", async () => {
		const { logger } = testLogger();
		const source: UsageSessionSource = {
			find: () => ({ contextUsage: true, agent: { contextUsage: async () => null } }),
		};
		const reader = new SessionUsageReader({ logger, sessions: source });

		const result = await reader.contextUsage(sessionId);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("context_usage_unavailable");
	});

	test("SIDE-17 plan usage becomes rate limits on the answer", async () => {
		const { logger } = testLogger();
		const limits: RateLimit[] = [
			{ label: "5-hour limit", usedPercent: 12, windowMinutes: 300, resetsAt: 1_800_000_000_000 },
		];
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: true,
				agent: {
					contextUsage: async () => ({ usedTokens: 10, windowTokens: 100 }),
					planUsage: async () => limits,
				},
			}),
		};
		const reader = new SessionUsageReader({ logger, sessions: source });

		expect(await reader.contextUsage(sessionId)).toEqual({
			ok: true,
			value: { usedTokens: 10, windowTokens: 100, rateLimits: limits },
		});
	});

	test("SIDE-17 a refused plan usage call is swallowed and leaves the limits empty", async () => {
		const { logger, records } = testLogger();
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: true,
				agent: {
					contextUsage: async () => ({ usedTokens: 10, windowTokens: 100 }),
					planUsage: async () => {
						throw new Error("not signed in with a plan");
					},
				},
			}),
		};
		const reader = new SessionUsageReader({ logger, sessions: source });

		const result = await reader.contextUsage(sessionId);
		expect(result).toEqual({
			ok: true,
			value: { usedTokens: 10, windowTokens: 100, rateLimits: [] },
		});
		expect(records.some((record) => record.message.includes("Plan usage"))).toBe(true);
	});

	test("SIDE-17 plan usage is given up after the ten second hang guard", async () => {
		const { logger, records } = testLogger();
		const waits: number[] = [];
		let release: () => void = () => {};
		const hanging = new Promise<RateLimit[]>((resolve) => {
			release = () => resolve([{ label: "late", usedPercent: 1 }]);
		});
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: true,
				agent: {
					contextUsage: async () => ({ usedTokens: 10, windowTokens: 100 }),
					planUsage: async () => hanging,
				},
			}),
		};
		const reader = new SessionUsageReader({
			logger,
			sessions: source,
			after: (ms, fire) => {
				waits.push(ms);
				fire();
				return () => {};
			},
		});

		const result = await reader.contextUsage(sessionId);
		expect(waits).toEqual([PLAN_USAGE_TIMEOUT_MS]);
		expect(result).toEqual({
			ok: true,
			value: { usedTokens: 10, windowTokens: 100, rateLimits: [] },
		});
		expect(
			records.some(
				(record) => record.level === "debug" && record.message.includes("Plan usage timed out"),
			),
		).toBe(true);

		release();
		await hanging;
		expect(result).toEqual({
			ok: true,
			value: { usedTokens: 10, windowTokens: 100, rateLimits: [] },
		});
	});

	test("SIDE-17 a failed live query is an error value, not zero usage", async () => {
		const { logger, records } = testLogger();
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: true,
				agent: {
					contextUsage: async () => {
						throw new Error("the query ended");
					},
				},
			}),
		};
		const reader = new SessionUsageReader({ logger, sessions: source });

		const result = await reader.contextUsage(sessionId);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("context_usage_unavailable");
		expect(records.some((record) => record.message.includes("context usage"))).toBe(true);
	});

	test("SIDE-17 without a session source the reader says usage is unavailable", async () => {
		const { logger } = testLogger();
		const reader = new SessionUsageReader({ logger });

		const result = await reader.contextUsage(sessionId);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("context_usage_unavailable");
	});
});
