/**
 * @feature COMP-03 Mode chips
 * Owns: The small chips in the composer for plan mode and for auto-accepting edits.
 * Behaviour: ui-map.md 3.5 (plan mode toggle Shift+Tab, text turns link-coloured; chip 'Auto-accept
 * edits' with tooltip 'Disable auto-accept edits'), claude-runner.md 3.
 * Our design choice: Plan mode and tool approval map to SessionConfig.planMode and
 * requireToolApproval. The chip shows only when the mode is on, so the toolbar stays quiet.
 * Must handle: Switching plan mode in a running chat (applied live when the agent allows); an agent
 * without plan mode (chip hidden); Shift+Tab toggles while typing; the chip is a toggle button with
 * aria-pressed.
 * Test first: Clicking the plan chip calls sessions.updateConfig with planMode flipped.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ModeChipsProps {
	sessionId: SessionId;
}

export function ModeChips(_props: ModeChipsProps): never {
	return notImplemented("COMP-03");
}
