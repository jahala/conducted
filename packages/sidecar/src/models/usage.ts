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
 *  - plan usage unavailable (API key, Bedrock, Vertex): the plan field is omitted
 *  - utilization is a percentage from 0 to 100 and may be null: a null window is omitted
 * Test first: planUsageFromSdk with only a five-hour window returns that percentage and its reset
 * time in milliseconds, and no seven-day field.
 * Each window reports its own reset time.
 */
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { appToSidecarRequests, ResultOf } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { type AppError, notImplemented, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";

export const PLAN_USAGE_TIMEOUT_MS = 10_000;

export type ContextUsageResult = ResultOf<(typeof appToSidecarRequests)["getContextUsage"]>;
export type PlanUsage = NonNullable<ContextUsageResult["plan"]>;

export function planUsageFromSdk(response: SDKControlGetUsageResponse): PlanUsage | undefined {
	if (!response.rate_limits_available || !response.rate_limits) return undefined;
	const plan: PlanUsage = {};
	const five = response.rate_limits.five_hour;
	const seven = response.rate_limits.seven_day;
	if (five && five.utilization !== null) {
		plan.fiveHourUsedPercent = five.utilization;
		if (five.resets_at !== null) plan.fiveHourResetsAt = Date.parse(five.resets_at);
	}
	if (seven && seven.utilization !== null) {
		plan.sevenDayUsedPercent = seven.utilization;
		if (seven.resets_at !== null) plan.sevenDayResetsAt = Date.parse(seven.resets_at);
	}
	return Object.keys(plan).length === 0 ? undefined : plan;
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
