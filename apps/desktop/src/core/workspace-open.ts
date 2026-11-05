/**
 * @feature NAV-02 Workspace open rule
 * Owns: the one rule for whether a workspace's route can still open, shared by the router, the restore
 * decision and the sidebar list.
 * Behaviour: ui-map.md 2 (the "/" route skips archived workspaces), services-map.md 6 (an archived workspace
 * goes Home instead of drawing a dead screen).
 * Our design choice: a workspace can open while it exists and is neither archiving nor archived. An archived
 * date counts even when the state has not caught up, so a row cannot outlive its files.
 * Test first: a ready workspace that carries an archived date cannot open; an archiving one cannot either.
 */
import type { Workspace } from "./model.ts";

/** True when the workspace's route can still open. */
export function canOpenWorkspace(workspace: Pick<Workspace, "state" | "archivedAt">): boolean {
	return (
		workspace.state !== "archived" &&
		workspace.state !== "archiving" &&
		workspace.archivedAt === null
	);
}
