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
 *
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: the signed-in account in the same answer, and the conversions from the Claude SDK's
 * account info and from Codex's `account/read` and `account/rateLimits/read` answers.
 * Behaviour: Conductor's popover rows (renderApp `BXo`, `CGi` for Claude; `EGi`, `AXo` for Codex);
 * the codex app-server 0.154.0 shapes (`generate-ts`: Account, RateLimitSnapshot).
 * Must handle: an account read that is refused or hangs (logged at debug, the account is left
 * out, behind the same 10 s guard as plan usage); fields with no value (left out); a Codex plan
 * of "unknown" (left out); Codex reset times in seconds (made milliseconds).
 * Test first: subscription type "max" becomes plan "Max" and login method "Claude account".
 *
 * Our design choice: the reader asks a session source for the chat's live agent. The composition
 * root (SIDE-01) supplies the session manager as that source; this file does not reach into the
 * manager. Until a source is supplied, the request answers context_usage_unavailable rather than
 * inventing zero usage.
 */
import type { AccountInfo, SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { appToSidecarRequests, RateLimit, ResultOf } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { type AppError, appError, err, messageOf, ok, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { asRecord } from "../util/records.ts";

export const PLAN_USAGE_TIMEOUT_MS = 10_000;

export type ContextUsageResult = ResultOf<(typeof appToSidecarRequests)["getContextUsage"]>;

/** The two Claude plan windows, in the order the usage popover lists them. */
const CLAUDE_WINDOWS = [
	{ key: "five_hour", label: "5-hour limit", windowMinutes: 5 * 60 },
	{ key: "seven_day", label: "7-day limit", windowMinutes: 7 * 24 * 60 },
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

/** The signed-in account in the usage answer (CHAT-28). */
export type UsageAccountView = NonNullable<ContextUsageResult["account"]>;

/** Conductor's names for the Claude API backends (renderApp `CGi`). */
const CLAUDE_PROVIDERS: Readonly<Record<string, string>> = {
	firstParty: "Anthropic API",
	bedrock: "AWS Bedrock",
	vertex: "Google Vertex AI",
	foundry: "Microsoft Foundry",
	anthropicAws: "Anthropic (AWS)",
	mantle: "Mantle",
};

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Drops the fields with no value; no fields at all is no account. */
function present(account: UsageAccountView): UsageAccountView | undefined {
	const entries = Object.entries(account).filter(
		([, value]) => typeof value === "string" && value !== "",
	);
	return entries.length === 0 ? undefined : (Object.fromEntries(entries) as UsageAccountView);
}

/**
 * The Claude SDK's account as the popover's rows, as Conductor shows them (renderApp `BXo`): the
 * provider, the plan, "Claude account" for a sign-in or "API key" as Auth for a key, and the email.
 */
export function accountFromSdk(info: AccountInfo): UsageAccountView | undefined {
	const signedIn = info.subscriptionType !== undefined || info.tokenSource !== undefined;
	return present({
		provider: info.apiProvider === undefined ? undefined : CLAUDE_PROVIDERS[info.apiProvider],
		plan: info.subscriptionType === undefined ? undefined : capitalised(info.subscriptionType),
		loginMethod: signedIn ? "Claude account" : undefined,
		auth: !signedIn && info.apiKeySource !== undefined ? "API key" : undefined,
		email: info.email,
	});
}

/** Conductor's provider and auth names for Codex's account types (renderApp `EGi`). */
const CODEX_ACCOUNTS: Readonly<Record<string, { provider: string; auth: string }>> = {
	chatgpt: { provider: "OpenAI", auth: "ChatGPT login" },
	apiKey: { provider: "OpenAI API", auth: "API key" },
	amazonBedrock: { provider: "Amazon Bedrock", auth: "AWS credentials" },
};

/** Codex's `account/read` answer as the popover's rows (renderApp `EGi`). */
export function accountFromCodex(answer: unknown): UsageAccountView | undefined {
	const account = asRecord(asRecord(answer)?.account);
	if (account === null || typeof account.type !== "string") return undefined;
	const names = CODEX_ACCOUNTS[account.type];
	const plan = typeof account.planType === "string" ? account.planType : undefined;
	return present({
		provider: names?.provider,
		plan: plan === undefined || plan === "unknown" ? undefined : capitalised(plan),
		auth: names?.auth,
		email: typeof account.email === "string" ? account.email : undefined,
	});
}

/** One Codex window (`RateLimitWindow`): a percentage, a length in minutes, a reset in seconds. */
function codexWindow(label: string, value: unknown): RateLimit | null {
	const window = asRecord(value);
	if (window === null || typeof window.usedPercent !== "number") return null;
	const limit: RateLimit = { label, usedPercent: Math.max(0, window.usedPercent) };
	if (typeof window.windowDurationMins === "number" && window.windowDurationMins > 0) {
		limit.windowMinutes = window.windowDurationMins;
	}
	if (typeof window.resetsAt === "number") limit.resetsAt = window.resetsAt * 1000;
	return limit;
}

/** Codex's `account/rateLimits/read` answer as limits: its primary and secondary windows. */
export function rateLimitsFromCodex(answer: unknown): RateLimit[] {
	const snapshot = asRecord(asRecord(answer)?.rateLimits);
	if (snapshot === null) return [];
	return [
		codexWindow("Primary limit", snapshot.primary),
		codexWindow("Secondary limit", snapshot.secondary),
	].filter((limit): limit is RateLimit => limit !== null);
}

/** A live agent, as far as context usage is concerned. */
export interface UsageAgent {
	/** The chat's used and total tokens, or null when the agent has not reported a window yet. */
	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null>;
	/** The account's plan limits, when the agent reports them. Other agents have no such method. */
	planUsage?(): Promise<RateLimit[]>;
	/** Who the agent is signed in as (Claude and Codex). Undefined when it does not say. */
	account?(): Promise<UsageAccountView | undefined>;
}

/** Where the reader finds a chat's live agent. The composition root supplies the session manager. */
export interface UsageSessionSource {
	/**
	 * Null agent when the chat is known but has no live agent yet. Undefined when this sidecar has
	 * no state for the chat: it restarted or never saw it.
	 */
	find(sessionId: SessionId): { agent: UsageAgent | null; contextUsage: boolean } | undefined;
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
		if (found.agent === null) {
			return err(
				appError("context_usage_unavailable", "This chat has not reported its context window."),
			);
		}
		if (!found.contextUsage) {
			return err(
				appError("context_usage_unavailable", "This agent does not report context usage."),
			);
		}
		const agent = found.agent;
		let usage: { usedTokens: number; windowTokens: number } | null;
		try {
			usage = await agent.contextUsage();
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
		const [rateLimits, account] = await Promise.all([
			this.planLimits(sessionId, agent),
			this.account(sessionId, agent),
		]);
		return ok({
			usedTokens: usage.usedTokens,
			windowTokens: usage.windowTokens,
			rateLimits,
			...(account === undefined ? {} : { account }),
		});
	}

	/** The signed-in account, or undefined when the agent has none, refuses, or takes over 10 s. */
	private async account(
		sessionId: SessionId,
		agent: UsageAgent,
	): Promise<UsageAccountView | undefined> {
		const read = agent.account;
		if (read === undefined) return undefined;
		const answer = await this.withinHangGuard(() => read.call(agent));
		if (answer.kind === "timeout") {
			this.deps.logger.debug("Account info timed out", {
				sessionId,
				timeoutMs: PLAN_USAGE_TIMEOUT_MS,
			});
			return undefined;
		}
		if (answer.kind === "failed") {
			this.deps.logger.debug("Account info was not available", {
				sessionId,
				message: messageOf(answer.cause),
			});
			return undefined;
		}
		return answer.value;
	}

	/** Runs `work` against the plan usage hang guard. */
	private async withinHangGuard<T>(
		work: () => Promise<T>,
	): Promise<{ kind: "ok"; value: T } | { kind: "timeout" } | { kind: "failed"; cause: unknown }> {
		const after = this.deps.after ?? afterWithSetTimeout;
		let cancelTimeout: () => void = () => {};
		const timedOut = new Promise<{ kind: "timeout" }>((resolve) => {
			cancelTimeout = after(PLAN_USAGE_TIMEOUT_MS, () => resolve({ kind: "timeout" }));
		});
		try {
			return await Promise.race([
				work().then((value) => ({ kind: "ok" as const, value })),
				timedOut,
			]);
		} catch (cause) {
			return { kind: "failed", cause };
		} finally {
			cancelTimeout();
		}
	}

	/** Plan limits, or an empty list when the agent has none, refuses, or takes over 10 s. */
	private async planLimits(sessionId: SessionId, agent: UsageAgent): Promise<RateLimit[]> {
		const planUsage = agent.planUsage;
		if (planUsage === undefined) return [];
		const answer = await this.withinHangGuard(() => planUsage.call(agent));
		if (answer.kind === "timeout") {
			this.deps.logger.debug("Plan usage timed out", {
				sessionId,
				timeoutMs: PLAN_USAGE_TIMEOUT_MS,
			});
			return [];
		}
		if (answer.kind === "failed") {
			this.deps.logger.debug("Plan usage was not available", {
				sessionId,
				message: messageOf(answer.cause),
			});
			return [];
		}
		return answer.value;
	}
}
