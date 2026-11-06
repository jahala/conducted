/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: tests that the sidecar's usage answer carries the signed-in Claude account and that a
 * refused or hung account read leaves the rows out instead of inventing values.
 * Behaviour: claude-runner.md 7 and the SDK's accountInfo answer; Conductor's popover rows
 * (renderApp `BXo` and `CGi` for Claude, `EGi` and `AXo` for Codex); the `account/read` and
 * `account/rateLimits/read` shapes of codex app-server 0.154.0 (`generate-ts`).
 * Test first: subscription type "max" becomes plan "Max" and login method "Claude account".
 */
import { describe, expect, test } from "bun:test";
import type { RateLimit } from "@conducted/protocol";
import { type SessionId, systemClock } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import {
	accountFromCodex,
	accountFromSdk,
	PLAN_USAGE_TIMEOUT_MS,
	rateLimitsFromCodex,
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
	test("CHAT-28 a subscription becomes the provider, a capitalised plan and the login method", () => {
		expect(
			accountFromSdk({
				email: "person@example.com",
				organization: "Anthropic",
				subscriptionType: "max",
				apiProvider: "firstParty",
			}),
		).toEqual({
			provider: "Anthropic API",
			plan: "Max",
			loginMethod: "Claude account",
			email: "person@example.com",
		});
	});

	test("CHAT-28 an API key account shows Auth and invents no plan", () => {
		expect(
			accountFromSdk({ email: "person@example.com", apiKeySource: "ANTHROPIC_API_KEY" }),
		).toEqual({ auth: "API key", email: "person@example.com" });
	});

	test("CHAT-28 a token sign-in without a plan is still a Claude account", () => {
		expect(accountFromSdk({ tokenSource: "claude.ai" })).toEqual({ loginMethod: "Claude account" });
	});

	test("CHAT-28 a cloud provider is named", () => {
		expect(accountFromSdk({ apiProvider: "bedrock" })).toEqual({ provider: "AWS Bedrock" });
		expect(accountFromSdk({ apiProvider: "vertex" })).toEqual({ provider: "Google Vertex AI" });
	});

	test("CHAT-28 an answer with no fields gives no account", () => {
		expect(accountFromSdk({})).toBeUndefined();
	});
});

describe("CHAT-28 the Codex account and limits", () => {
	test("CHAT-28 a ChatGPT sign-in becomes OpenAI, its plan, ChatGPT login and the email", () => {
		expect(
			accountFromCodex({
				account: { type: "chatgpt", email: "person@example.com", planType: "plus" },
				requiresOpenaiAuth: true,
			}),
		).toEqual({
			provider: "OpenAI",
			plan: "Plus",
			auth: "ChatGPT login",
			email: "person@example.com",
		});
	});

	test("CHAT-28 an API key and Bedrock name their provider and auth", () => {
		expect(accountFromCodex({ account: { type: "apiKey" } })).toEqual({
			provider: "OpenAI API",
			auth: "API key",
		});
		expect(
			accountFromCodex({ account: { type: "amazonBedrock", usesCodexManagedCredentials: false } }),
		).toEqual({ provider: "Amazon Bedrock", auth: "AWS credentials" });
	});

	test("CHAT-28 an unknown plan and a missing account are left out", () => {
		expect(
			accountFromCodex({ account: { type: "chatgpt", email: null, planType: "unknown" } }),
		).toEqual({ provider: "OpenAI", auth: "ChatGPT login" });
		expect(accountFromCodex({ account: null, requiresOpenaiAuth: true })).toBeUndefined();
		expect(accountFromCodex("not an answer")).toBeUndefined();
	});

	test("CHAT-28 the primary and secondary windows become limits with reset times in ms", () => {
		expect(
			rateLimitsFromCodex({
				rateLimits: {
					primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1_800_000_000 },
					secondary: { usedPercent: 80, windowDurationMins: 10_080, resetsAt: null },
				},
			}),
		).toEqual([
			{ label: "Primary limit", usedPercent: 30, windowMinutes: 300, resetsAt: 1_800_000_000_000 },
			{ label: "Secondary limit", usedPercent: 80, windowMinutes: 10_080 },
		]);
		expect(rateLimitsFromCodex({ rateLimits: { primary: null, secondary: null } })).toEqual([]);
		expect(rateLimitsFromCodex(null)).toEqual([]);
	});
});

describe("CHAT-28 the usage answer carries the account", () => {
	test("CHAT-28 the account is part of the answer beside the limits", async () => {
		const { logger } = testLogger();
		const account: UsageAccountView = {
			provider: "Anthropic API",
			plan: "Max",
			loginMethod: "Claude account",
			email: "person@example.com",
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
