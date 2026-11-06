/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: tests that the sidecar's usage answer carries the signed-in Claude account and that a
 * refused or hung account read leaves the rows out instead of inventing values.
 * Behaviour: claude-runner.md 7 and the SDK's accountInfo answer.
 * Test first: subscription type "max" becomes login method "Claude subscription" and plan "Max".
 */
import { describe, expect, test } from "bun:test";
import type { RateLimit } from "@conducted/protocol";
import { type SessionId, systemClock } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import {
	accountFromSdk,
	PLAN_USAGE_TIMEOUT_MS,
	SessionUsageReader,
	type UsageAccountView,
	type UsageSessionSource,
} from "./usage.ts";

const sessionId = "session-1" as SessionId;

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

describe("CHAT-28 the account from the SDK", () => {
	test("CHAT-28 a subscription becomes the login method and a capitalised plan", () => {
		expect(
			accountFromSdk({
				email: "person@example.com",
				organization: "Anthropic",
				subscriptionType: "max",
			}),
		).toEqual({
			loginMethod: "Claude subscription",
			organization: "Anthropic",
			email: "person@example.com",
			plan: "Max",
		});
	});

	test("CHAT-28 an API key account keeps the fields it has and invents no plan", () => {
		expect(accountFromSdk({ email: "person@example.com", subscriptionType: null })).toEqual({
			email: "person@example.com",
		});
	});

	test("CHAT-28 an answer with no fields gives no account", () => {
		expect(accountFromSdk({})).toBeUndefined();
	});
});

describe("CHAT-28 the usage answer carries the account", () => {
	test("CHAT-28 the account is part of the answer beside the limits", async () => {
		const { logger } = testLogger();
		const account: UsageAccountView = {
			loginMethod: "Claude subscription",
			organization: "Anthropic",
			email: "person@example.com",
			plan: "Max",
		};
		const limits: RateLimit[] = [{ label: "5-hour limit", usedPercent: 12, windowMinutes: 300 }];
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: true,
				agent: {
					contextUsage: async () => ({ usedTokens: 10, windowTokens: 100 }),
					planUsage: async () => limits,
					account: async () => account,
				},
			}),
		};
		const reader = new SessionUsageReader({ logger, sessions: source });

		expect(await reader.contextUsage(sessionId)).toEqual({
			ok: true,
			value: { usedTokens: 10, windowTokens: 100, rateLimits: limits, account },
		});
	});

	test("CHAT-28 a refused account read leaves the account out", async () => {
		const { logger, records } = testLogger();
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: true,
				agent: {
					contextUsage: async () => ({ usedTokens: 10, windowTokens: 100 }),
					account: async () => {
						throw new Error("the account could not be read");
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
		expect(records.some((record) => record.message.includes("Account"))).toBe(true);
	});

	test("CHAT-28 a hung account read gives up at the hang guard", async () => {
		const { logger, records } = testLogger();
		const waits: number[] = [];
		const source: UsageSessionSource = {
			find: () => ({
				contextUsage: true,
				agent: {
					contextUsage: async () => ({ usedTokens: 10, windowTokens: 100 }),
					account: async () => new Promise<UsageAccountView>(() => {}),
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
				(record) => record.level === "debug" && record.message.includes("Account info timed out"),
			),
		).toBe(true);
	});
});
