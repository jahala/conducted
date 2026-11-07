/**
 * @feature AGENT-02 Claude: Agent SDK in streaming-input mode
 * Owns: the fixed values the Claude runner passes to the SDK, each with the research that fixes it.
 * Behaviour: research/conductor/claude-runner.md section 1.2 (options), 1.3 (environment) and
 * section 2 (turn bookkeeping).
 * Must handle: nothing at runtime; these are constants. The values are stated as ours; where
 * Conductor uses the same number, the comment says so.
 * Test first: CLAUDE_TOOL_ALIASES maps AskUserQuestion to the tool under our own server name.
 */
import { APP_TOOL_SERVER } from "@conducted/protocol";

/**
 * The thinking budget, in tokens, for a model without adaptive thinking, by effort. Conductor's
 * catalog defaults (`thinkingBudgets` in its bundled Claude catalog); the sidecar differential run
 * saw `--max-thinking-tokens=16000` for Sonnet 4.6 at high effort.
 */
export const CLAUDE_THINKING_BUDGETS: Readonly<
	Record<"low" | "medium" | "high" | "xhigh" | "max", number>
> = { low: 1024, medium: 8192, high: 16_000, xhigh: 63_999, max: 63_999 };

/** Upper bound on agent turns per user message. Conductor passes 1000. */
export const CLAUDE_MAX_TURNS = 1000;

/** Which settings files the Claude CLI reads. Conductor passes all three. */
export const CLAUDE_SETTING_SOURCES = ["user", "project", "local"] as const;

/** The built-in question tool is off. The app tool of the same name replaces it. */
export const CLAUDE_DISALLOWED_TOOLS: readonly string[] = ["AskUserQuestion"];

export const CLAUDE_TOOL_ALIASES: Readonly<Record<string, string>> = {
	AskUserQuestion: `mcp__${APP_TOOL_SERVER}__AskUserQuestion`,
};

/** Prefix of every app tool name as the model sees it. */
export const APP_TOOL_NAME_PREFIX = `mcp__${APP_TOOL_SERVER}__`;

/**
 * Environment variables the runner adds to the CLI process. The first makes the CLI report when a
 * turn starts and ends, which also covers turns the CLI starts by itself (background tasks).
 */
export const CLAUDE_LAUNCH_ENV: Readonly<Record<string, string>> = {
	CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
};

/**
 * After a result that was ignored (not ours, or held back for a steer), force the turn to end
 * if no follow-up turn starts within this time. Conductor: 120 000 ms.
 */
export const SETTLEMENT_WATCHDOG_MS = 120_000;

/**
 * How long cancel() waits for the turn to end after an in-band interrupt before it stops the
 * process. Our design choice; Conductor never interrupts and always kills.
 */
export const INTERRUPT_GRACE_MS = 5_000;
