/**
 * @feature AGENT-16 Chat options the settings offer: output style, personality, effort, Chrome
 * Owns: the Claude half of the chat options: the effort and thinking options, the settings JSON
 * (output style, fast mode, ultracode) and the Chrome flag, taken from a chat's `SessionConfig`.
 * Behaviour: claude-runner.md 1.2 (option table: effort `none` is omitted and `ultra` becomes
 * `max`, thinking can be disabled, adaptive or on with a budget, a settings JSON carries the output
 * style, fast mode and ultracode, `--chrome` is an extra argument) and 1.5 (output style,
 * ultracode, Chrome and fast mode restart Claude with resume).
 * Must handle: effort `none` (no effort option, thinking disabled); effort `ultra` (sent as `max`);
 * effort `ultracode` (not sent as an effort; the settings JSON carries it, which is how Claude reads
 * it); output style `default` or missing (not written to the settings JSON); a settings JSON with
 * nothing in it (undefined, so no `--settings` is passed); `claudeInChrome` missing or false (no
 * Chrome flag); a change of output style, ultracode or Chrome between turns (a restart with
 * resume, never during a turn); the toast text for a changed output style is the app's
 * ("Claude output style updated. New chats will use it; existing chats won't change.").
 * Our design choice: `classifyConfigChange` in `config-change.ts` calls `claudeRestartNeeded` when
 * this is built, so there is one list of what restarts Claude.
 * Test first: effort `ultra` gives the effort option `max`; effort `none` gives none and a
 * disabled thinking option.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { Effort, SessionConfig } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

/** The effort option for the SDK, or undefined when none is sent. */
export function claudeEffortOption(_effort: Effort): Options["effort"] | undefined {
	return notImplemented("AGENT-16");
}

/** Thinking is disabled for effort `none`, adaptive otherwise. */
export function claudeThinkingOption(_effort: Effort): Options["thinking"] {
	return notImplemented("AGENT-16");
}

/** The settings JSON: output style, fast mode, ultracode. Undefined when nothing is set. */
export function claudeSettingsOption(_config: SessionConfig): Options["settings"] | undefined {
	return notImplemented("AGENT-16");
}

/** Extra command-line flags: `--chrome` when Claude in Chrome is on. */
export function claudeExtraArguments(_config: SessionConfig): Options["extraArgs"] | undefined {
	return notImplemented("AGENT-16");
}

/** True when the change needs Claude to restart with resume: output style, ultracode or Chrome. */
export function claudeRestartNeeded(_prev: SessionConfig, _next: SessionConfig): boolean {
	return notImplemented("AGENT-16");
}
