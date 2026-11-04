/**
 * @feature WS-03 Setup status bar
 * Owns: the line above the setup output. A state icon, the text for the state, and the primary
 * action (Stop, Run again, Ask agent to fix).
 * Behaviour: ui-map.md 3.7, "Setup" paragraph (state texts: running, failed, cancelled, detecting,
 * stopping).
 * Must handle: an exit code shown for failures, an interrupted-by-quit note, the action disabled
 * while a request is in flight, and a long reason text (two lines, expandable).
 * Test first: kind "running" shows a Stop action and kind "completed" shows Run again.
 */
import { notImplemented } from "@conducted/shared";
import type { SetupTabKind } from "./setup-state.ts";

export interface SetupStatusBarProps {
	kind: SetupTabKind;
	exitCode: number | null;
	interruptedReason: string | null;
	busy: boolean;
	onStop: () => void;
	onRunAgain: () => void;
	onAskAgentToFix: () => void;
}

export function SetupStatusBar(_props: SetupStatusBarProps): never {
	return notImplemented("WS-03");
}
