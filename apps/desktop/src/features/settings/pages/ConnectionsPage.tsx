/**
 * @feature SET-02 Connections settings page
 * Owns: the Connections page of Settings, local ports only: the port range workspaces draw from.
 * Behaviour: ui-map.md 3.7 and 6 ("Connections": in Conductor this page covers cloud port
 * forwarding, which is left out) and backlog RUN-03 (one port per workspace, detection, preview
 * URLs).
 * Our design choice: Conductor's page has no local-only content, so ours holds the two settings the
 * local port feature needs. Keys are not in the research; SET-01 defines them.
 * Rows (our wording), control:
 *   Workspace port range          two number fields: first and last port, validated to 1024..65535
 *                                 and at least as many ports as the workspace limit
 *   Reserved ports                a list of ports never given to a workspace, with add and remove
 * Data: useSetting, useActions().settings; the count of ports in use needs useWorkspaces().
 * Must handle: a range smaller than the number of workspaces (warning with the shortfall), a change
 * that would move ports already given out (explains it only affects new workspaces), ports below
 * 1024 or above 65535 (rejected), first greater than last (rejected), and port 22 never allowed.
 * Test first: a range of 3000 to 2000 shows an error and does not call settings.set.
 */
import { notImplemented } from "@conducted/shared";

export function ConnectionsPage(): never {
	return notImplemented("SET-02");
}
