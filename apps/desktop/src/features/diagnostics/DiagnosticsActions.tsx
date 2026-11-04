/**
 * @feature APP-03 Diagnostics actions
 * Owns: the row of buttons on the diagnostics page: copy redacted report, copy full report, start
 * a chat with the redacted report attached, copy logs, and restart.
 * Behaviour: ui-map.md 2, `/diagnostics` (button list; "Copy logs (may include personal data)").
 * Must handle: each action having its own busy and result state (copied, failed), the full report
 * and the logs asking for confirmation because they can hold personal data, the chat action
 * disabled when no workspace exists, restart asking first when an agent is working, and clipboard
 * failure (shows the text in a box to copy by hand).
 * Test first: copying the full report asks for confirmation and copies nothing until it is given.
 */
import { notImplemented } from "@conducted/shared";

export type DiagnosticsAction =
	| "copy_redacted"
	| "copy_full"
	| "start_chat"
	| "copy_logs"
	| "restart";

export interface DiagnosticsActionsProps {
	busy: DiagnosticsAction | null;
	canStartChat: boolean;
	agentsWorking: boolean;
	onAction: (action: DiagnosticsAction) => void;
}

export function DiagnosticsActions(_props: DiagnosticsActionsProps): never {
	return notImplemented("APP-03");
}
