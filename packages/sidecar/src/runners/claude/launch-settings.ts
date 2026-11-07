/**
 * @feature AGENT-16 Chat options the settings offer: output style, personality, effort, Chrome
 * Owns: the Claude half of the chat options: the effort and thinking options, the settings JSON
 * (output style, fast mode, ultracode) and the Chrome flag, taken from a chat's `SessionConfig`.
 * Behaviour: claude-runner.md 1.2 (option table: effort `none` is omitted and `ultra` becomes
 * `max`, a settings JSON carries the output style, fast mode and ultracode, `--chrome` is an extra
 * argument) and 1.5 (output style, ultracode, Chrome and fast mode restart Claude with resume).
 * Thinking is disabled for effort `none`. Otherwise a model with adaptive thinking thinks
 * adaptively, and a model without it gets a token budget for the effort (CLAUDE_THINKING_BUDGETS,
 * Conductor's catalog defaults). Whether a model is adaptive comes from the model catalog, which
 * reads the Agent SDK's `supportsAdaptiveThinking` (SIDE-14).
 * Must handle: effort `none` (no effort option, thinking disabled); effort `ultra` (sent as `max`,
 * and thinks with max's budget on a model without adaptive thinking); a model the catalog does not
 * describe, or an effort with no budget (`ultracode`): adaptive, the SDK's default for models that
 * support it;
 * effort `ultracode` (not sent as an effort; the settings JSON carries it, which is how Claude reads
 * it); output style `default` or missing (not written to the settings JSON); a settings JSON with
 * nothing in it (undefined, so no `--settings` is passed); `claudeInChrome` missing or false (no
 * Chrome flag); a change of output style, ultracode or Chrome between turns (a restart with
 * resume, never during a turn).
 * The toast text shown when the output style setting changes belongs to the app's settings page
 * (SET-02), not to this file.
 * Our design choice: `classifyConfigChange` in `config-change.ts` calls `claudeRestartNeeded` so
 * there is one list of what restarts Claude.
 * Test first: effort `ultra` gives the effort option `max`; effort `none` gives none and a
 * disabled thinking option.
 */
import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";
import type { Effort, SessionConfig } from "@conducted/protocol";
import { CLAUDE_THINKING_BUDGETS } from "./constants.ts";

/** The effort option for the SDK, or undefined when none is sent. */
export function claudeEffortOption(effort: Effort): Options["effort"] | undefined {
	switch (effort) {
		case "none":
		case "ultracode":
			return undefined;
		case "ultra":
			return "max";
		default:
			return effort;
	}
}

/**
 * Thinking is disabled for effort `none`. A model without adaptive thinking (`adaptiveThinking`
 * false) gets the effort's token budget; any other model thinks adaptively.
 */
export function claudeThinkingOption(
	effort: Effort,
	adaptiveThinking: boolean | undefined,
): Options["thinking"] {
	if (effort === "none") return { type: "disabled" };
	const budget = adaptiveThinking === false ? thinkingBudget(effort) : undefined;
	if (budget === undefined) return { type: "adaptive", display: "summarized" };
	return { type: "enabled", budgetTokens: budget, display: "summarized" };
}

function thinkingBudget(effort: Effort): number | undefined {
	switch (effort) {
		case "low":
		case "medium":
		case "high":
		case "xhigh":
		case "max":
			return CLAUDE_THINKING_BUDGETS[effort];
		case "ultra":
			// Ultra is sent as max (claudeEffortOption), so it thinks with max's budget.
			return CLAUDE_THINKING_BUDGETS.max;
		default:
			return undefined;
	}
}

/** The settings JSON: output style, fast mode, ultracode. Undefined when nothing is set. */
export function claudeSettingsOption(config: SessionConfig): Options["settings"] | undefined {
	const settings: Settings = {};
	if (config.claudeOutputStyle !== undefined && config.claudeOutputStyle !== "default") {
		settings.outputStyle = config.claudeOutputStyle;
	}
	if (config.fastMode) settings.fastMode = true;
	if (config.effort === "ultracode") settings.ultracode = true;
	return Object.keys(settings).length > 0 ? settings : undefined;
}

/** Extra command-line flags: `--chrome` when Claude in Chrome is on. */
export function claudeExtraArguments(config: SessionConfig): Options["extraArgs"] | undefined {
	return config.claudeInChrome === true ? { chrome: null } : undefined;
}

/** True when the change needs Claude to restart with resume: output style, ultracode or Chrome. */
export function claudeRestartNeeded(prev: SessionConfig, next: SessionConfig): boolean {
	return (
		(prev.claudeOutputStyle ?? "default") !== (next.claudeOutputStyle ?? "default") ||
		(prev.effort === "ultracode") !== (next.effort === "ultracode") ||
		(prev.claudeInChrome ?? false) !== (next.claudeInChrome ?? false)
	);
}
