/**
 * @feature WS-03 Setup tab
 * Owns: the Setup tab body. The status line, the live or saved output, and the actions for each
 * state.
 * Behaviour: ui-map.md 3.7, "Setup" paragraph (running, failed with a "fix it" prompt sent to the
 * chat, cancelled, detecting, stopping, empty, and logs that could not be loaded); services-map.md
 * 5A.1.2 (SetupProcessStore).
 * Data: useSetupState (shaped by setup-state.ts), useRepoConfig, useActions().
 * Children: SetupStatusBar, SetupEmptyState, terminal/TerminalView for live output.
 * Must handle: every SetupTabKind in setup-state.ts, Stop while running, "Run setup again" after a
 * failure, the fix action sending the failure log to the chat, a log that fails to load ("Couldn't
 * load the logs", with Retry), and an archived workspace.
 * Test first: kind "failed" shows the failure log and a fix action that calls the chat action once.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface SetupTabProps {
	workspaceId: WorkspaceId;
}

export function SetupTab(_props: SetupTabProps): never {
	return notImplemented("WS-03");
}
