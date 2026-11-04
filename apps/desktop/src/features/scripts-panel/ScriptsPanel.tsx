/**
 * @feature RUN-01 ScriptsPanel
 * Owns: right panel, bottom half. Tabs Setup, Run, Terminal N and Ports, a collapse control, and
 * the active tab. Entry point embedded by the workspace screen.
 * Behaviour: ui-map.md 3.7 (tabs, Cmd+J toggles the panel, "Open" and "Choose preview URL");
 * services-map.md 5A.1 (setup and action process stores).
 * Data: useRunState, useTerminals, useWorkspace, useRepoConfig (are there scripts), useActions().
 * Children: ScriptsPanelTabs, setup/SetupTab, run/RunTab, terminals/TerminalTabBody,
 * ports/PortsTab, and terminal/TerminalView for each terminal tab.
 * Our design choice: the active tab and the collapsed state live in this component for now; the
 * workspace screen can persist them through settings later.
 * Must handle: loading and error, archived workspace (terminals and scripts unavailable, saying
 * so), a workspace still initializing (Setup tab active and running), the active terminal being
 * closed (select its neighbour), the tab limit reached, a terminal dragged to the center (tab
 * disappears here), and collapse keeping process state alive.
 * Test first: with run state "running" the Run tab shows the Stop button for that action.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function ScriptsPanel(_props: { workspaceId: WorkspaceId }): never {
	return notImplemented("RUN-01");
}
