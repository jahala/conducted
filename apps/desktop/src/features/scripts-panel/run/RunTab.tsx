/**
 * @feature RUN-01 Run tab
 * Owns: the Run tab body. The action picker with the Run or Stop button and Open button, and the
 * live output of the running action.
 * Behaviour: ui-map.md 3.7, "Run" paragraph and "Run vs Spotlight"; services-map.md 5A.1.3, 5A.1.4
 * (concurrent or exclusive run mode), 5A.2 (Spotlight).
 * Data: useRunState (actions, running, spotlight, detectedPorts), useRepoConfig, useActions().run.
 * Children: RunToolbar, RunEmptyState, PreviewUrlMenu, terminal/TerminalView for the output.
 * Must handle: no actions (empty state), loading, the picked action disappearing (settings
 * edited), a run starting while setup is running (parked, button says so), the stop not
 * confirming, a process that exits by itself (output stays, button back to Run again), exclusive
 * mode stopping another workspace's run (a note), Spotlight replacing Run when the repository
 * setting is on, and an archived workspace.
 * Test first: with one action and no running process the toolbar shows "Run <label>".
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface RunTabProps {
	workspaceId: WorkspaceId;
}

export function RunTab(_props: RunTabProps): never {
	return notImplemented("RUN-01");
}
