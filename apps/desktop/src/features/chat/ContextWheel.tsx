/**
 * @feature CHAT-14 Context wheel
 * Owns: The small ring in the composer toolbar that shows how much of the model's context window is
 * used, with a hover card for details, cost and plan usage.
 * Behaviour: ui-map.md 3.3 (Context wheel: appears above 70% or always with the setting 'Always
 * show context usage'; hover card 'Context', 'Window used', tokens Input, Cached input, Output,
 * Reasoning output, model, effort, service tier; notes 'Context window size not yet available.' and
 * 'Context usage is unavailable for Cursor.'), claude-runner.md 7.
 * Our design choice: The ring is neutral until 85%, then warning, then danger at 95%. The hover
 * card opens on keyboard focus as well.
 * Must handle: Window size unknown (the note, no ring); agent without usage (the Cursor note);
 * usage above the window (clamp at 100%); the setting 'always show' off and under 70% (hidden);
 * the agent's rate limits (Claude's 5-hour and weekly windows, Codex's primary and secondary) when
 * it reports them.
 * Test first: 72,000 of 100,000 tokens shows a 72% ring; 40% with the setting off renders nothing.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ContextWheelProps {
	sessionId: SessionId;
}

export function ContextWheel(_props: ContextWheelProps): never {
	return notImplemented("CHAT-14");
}
