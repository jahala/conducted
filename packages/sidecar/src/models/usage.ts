/**
 * @feature SIDE-17 Context and plan usage
 * Owns: answering getContextUsage with the used and total tokens of a chat, plus the plan limits
 * when the agent reports them, and the conversion from the Claude SDK's usage response.
 * Behaviour: research/conductor/claude-runner.md section 7 (context usage is asked on demand, from
 * the live query object or a throwaway one; plan usage has a 10 s timeout and failures are
 * swallowed; windows are five hours and seven days).
 * Must handle:
 *  - an unknown session: RPC_ERRORS.sessionUnknown
 *  - an agent without context usage (capabilities.contextUsage false): the result is an error value
 *    the UI shows as "not available", never zero
 *  - plan usage unavailable (API key, Bedrock, Vertex): the rate limit list is empty
 *  - utilization is a percentage from 0 to 100 and may be null: a null window is omitted
 * Test first: rateLimitsFromSdk with only a five-hour window returns that one limit with its
 * percentage and its reset time in milliseconds.
 * Each window reports its own reset time.
 */
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { appToSidecarRequests, RateLimit, ResultOf } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { type AppError, notImplemented, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";

export const PLAN_USAGE_TIMEOUT_MS = 10_000;

export type ContextUsageResult = ResultOf<(typeof appToSidecarRequests)["getContextUsage"]>;

/** The two Claude plan windows, in the order the usage popover lists them. */
const CLAUDE_WINDOWS = [
	{ key: "five_hour", label: "5-hour limit", windowMinutes: 5 * 60 },
	{ key: "seven_day", label: "Weekly limit", windowMinutes: 7 * 24 * 60 },
] as const;

/** The Claude SDK's plan usage as rate limits. A window with no utilization is left out. */
export function rateLimitsFromSdk(response: SDKControlGetUsageResponse): RateLimit[] {
	if (!response.rate_limits_available || !response.rate_limits) return [];
	const limits: RateLimit[] = [];
	for (const { key, label, windowMinutes } of CLAUDE_WINDOWS) {
		const window = response.rate_limits[key];
		if (!window || window.utilization === null) continue;
		const limit: RateLimit = { label, usedPercent: window.utilization, windowMinutes };
		if (window.resets_at !== null) limit.resetsAt = Date.parse(window.resets_at);
		limits.push(limit);
	}
	return limits;
}

export interface UsageReader {
	contextUsage(sessionId: SessionId): Promise<Result<ContextUsageResult, AppError>>;
}

export class SessionUsageReader implements UsageReader {
	constructor(protected readonly deps: { logger: Logger }) {}

	contextUsage(_sessionId: SessionId): Promise<Result<ContextUsageResult, AppError>> {
		return notImplemented("SIDE-17");
	}
}
