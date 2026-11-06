/**
 * @feature NAV-01 Panel sizes
 * Owns: the sizes of the resizable panels, which the panel library takes from script rather than CSS.
 * Behaviour: research/conductor/ui-dimensions.md 3 (left sidebar 256px by default, 192px to 480px, collapses to
 * 0; right panel split 50 and 50, the scripts panel at least 20% and collapsing to its 32px tab strip).
 * Our design choice: the centre and right panel keep 65% and 35%. Conductor asks for 70% and 35%, which the
 * library rescales (ui-dimensions.md 11). Conductor also caps the sidebar at 40% of the window; one maximum is
 * kept here, the 480px one. The centre keeps a minimum width so the chat stays usable.
 * Must handle: sizes are strings with a unit, as ui/resizable.tsx requires. The group ids live here too, so
 * the layout that names a group and the cleanup that removes its saved sizes use one name.
 * Test first: none; these are values read by AppShell and WorkspaceLayout.
 */

/** The id the shell's panel layout is saved under. */
export const appShellGroupId = "app-shell";

/** The panel group that splits a workspace's main content from its right panel. */
export const workspaceLayoutGroupId = (workspaceId: string): string =>
	`workspace-layout-${workspaceId}`;

/** The panel group that splits a workspace's Git panel from its scripts panel. */
export const workspaceRightPanelsGroupId = (workspaceId: string): string =>
	`workspace-right-panels-${workspaceId}`;

export const sidebarSize = {
	default: "256px",
	min: "192px",
	max: "480px",
	collapsed: "0px",
} as const;

/** Below this the centre cannot show a chat column and a diff side by side. */
export const centreMinSize = "480px";

/** The scripts panel collapses to the height of its tab strip. */
export const scriptsPanelCollapsedSize = "32px";
