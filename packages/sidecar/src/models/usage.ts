/**
 * @feature SIDE-17 Context and plan usage
 * Owns: answering getContextUsage with the used and total tokens of a chat, plus the plan limits
 * when the agent reports them, and the conversion from the Claude SDK's usage response.
 * Behaviour: research/conductor/claude-runner.md section 7 (context usage is asked on demand from
 * the live query; plan usage has a 10 s timeout and failures are swallowed; windows are five hours
 * and seven days).
 * Must handle:
 *  - an unknown session: a session_unknown error, which the JSON-RPC peer answers as
 *    RPC_ERRORS.sessionUnknown
 *  - an agent without context usage (capabilities.contextUsage false): an error value the UI shows
 *    as "not available", never zero
 *  - a chat whose window is not known yet: the same error value, never zero
 *  - plan usage unavailable (API key, Bedrock, Vertex): the rate limit list is empty
 *  - a refused or timed-out plan usage call: logged at debug, the limits are empty
 *  - utilization is a percentage from 0 to 100 and may be null: a null window is omitted
 *  - a reset time that cannot be parsed: the limit is still reported, without resetsAt
 * Test first: rateLimitsFromSdk with only a five-hour window returns that one limit with its
 * percentage and its reset time in milliseconds.
 * Each window reports its own reset time.
 * Our design choice: the reader asks a session source for the chat's live agent. The composition
 * root (SIDE-01) supplies the session manager as that source; this file does not reach into the
 * manager. Until a source is supplied, the request answers context_usage_unavailable rather than
 * inventing zero usage.
 */
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { appToSidecarRequests, RateLimit, ResultOf } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { messageOf } from "../util/errors.ts";

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
		if (window.resets_at !== null) {
			const resetsAt = Date.parse(window.resets_at);
			if (Number.isFinite(resetsAt)) limit.resetsAt = resetsAt;
		}
		limits.push(limit);
	}
	return limits;
}

/** A live agent, as far as context usage is concerned. */
export interface UsageAgent {
	/** The chat's used and total tokens, or null when the agent has not reported a window yet. */
	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null>;
	/** The account's plan limits, when the agent reports them. Other agents have no such method. */
	planUsage?(): Promise<RateLimit[]>;
}

/** Where the reader finds a chat's live agent. The composition root supplies the session manager. */
export interface UsageSessionSource {
	/** Undefined when this sidecar has no state for the chat: it restarted or never saw it. */
	find(sessionId: SessionId): { agent: UsageAgent; contextUsage: boolean } | undefined;
}

export interface UsageReader {
	contextUsage(sessionId: SessionId): Promise<Result<ContextUsageResult, AppError>>;
}

export interface SessionUsageReaderDeps {
	logger: Logger;
	/** The chat's agent lookup. Without it every request answers context_usage_unavailable. */
	sessions?: UsageSessionSource;
	/** Calls `fn` after `ms` and returns a cancel. Tests pass a fake so no test waits 10 s. */
	after?: (ms: number, fn: () => void) => () => void;
}

/** The production timer behind the plan usage hang guard. */
function afterWithSetTimeout(ms: number, fn: () => void): () => void {
	const timer = setTimeout(fn, ms);
	return () => clearTimeout(timer);
}

export class SessionUsageReader implements UsageReader {
	constructor(protected readonly deps: SessionUsageReaderDeps) {}

	async contextUsage(sessionId: SessionId): Promise<Result<ContextUsageResult, AppError>> {
		const source = this.deps.sessions;
		if (source === undefined) {
			return err(
				appError(
					"context_usage_unavailable",
					"Context usage is not available because the sidecar has no session source.",
				),
			);
		}
		const found = source.find(sessionId);
		if (found === undefined) {
			return err(appError("session_unknown", "The sidecar has no state for this chat."));
		}
		if (!found.contextUsage) {
			return err(
				appError("context_usage_unavailable", "This agent does not report context usage."),
			);
		}
		let usage: { usedTokens: number; windowTokens: number } | null;
		try {
			usage = await found.agent.contextUsage();
		} catch (cause) {
			this.deps.logger.debug("Could not read the context usage", {
				sessionId,
				message: messageOf(cause),
			});
			return err(
				appError(
					"context_usage_unavailable",
					"Context usage could not be read for this chat.",
					cause,
				),
			);
		}
		if (usage === null) {
			return err(
				appError("context_usage_unavailable", "This chat has not reported its context window."),
			);
		}
		const rateLimits = await this.planLimits(sessionId, found.agent);
		return ok({ usedTokens: usage.usedTokens, windowTokens: usage.windowTokens, rateLimits });
	}

	/** Plan limits, or an empty list when the agent has none, refuses, or takes over 10 s. */
	private async planLimits(sessionId: SessionId, agent: UsageAgent): Promise<RateLimit[]> {
		const planUsage = agent.planUsage;
		if (planUsage === undefined) return [];
		const after = this.deps.after ?? afterWithSetTimeout;
		let cancelTimeout: () => void = () => {};
		const timedOut = new Promise<null>((resolve) => {
			cancelTimeout = after(PLAN_USAGE_TIMEOUT_MS, () => resolve(null));
		});
		try {
			const limits = await Promise.race([planUsage.call(agent), timedOut]);
			return limits ?? [];
		} catch (cause) {
			this.deps.logger.debug("Plan usage was not available", {
				sessionId,
				message: messageOf(cause),
			});
			return [];
		} finally {
			cancelTimeout();
		}
	}
}
