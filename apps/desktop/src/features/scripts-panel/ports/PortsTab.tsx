/**
 * @feature RUN-03 Ports tab
 * Owns: the list of local ports the workspace's processes are listening on, with open actions.
 * Behaviour: ui-map.md 3.7 ("Ports" special tab; empty text "No local servers running. Start your
 * dev server and it'll show up here."; "Open localhost URL" Cmd+Shift+B). Port forwarding to a
 * cloud machine is left out.
 * Data: useRunState (detectedPorts), useWorkspace (the workspace's own port).
 * Children: DetectedPortRow.
 * Must handle: no ports (designed empty state), a port that closes while listed (row disappears
 * without flicker), the workspace's reserved port marked, and ports owned by other workspaces
 * (not listed).
 * Test first: with detectedPorts [3000, 5173] two rows render in ascending order.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface PortsTabProps {
	workspaceId: WorkspaceId;
}

export function PortsTab(_props: PortsTabProps): never {
	return notImplemented("RUN-03");
}
