/**
 * @feature NAV-02 Workspace open rule
 * Owns: the one rule for whether a workspace can still be opened as live work, shared by the restore
 * decision, Passport and the sidebar list, and the rule for whether its route stays on screen.
 * Behaviour: ui-map.md 2 (the "/" route skips archived workspaces). An archived workspace's route stays on
 * screen with its chats readable, as in Conductor's workspace view (`isArchived`, renderApp @10132431); one
 * that is being archived goes Home, because its files are on their way out.
 * Our design choice: a workspace can open while it exists and is neither archiving nor archived. The
 * archived rule is `isArchivedWorkspace`, so a workspace being restored opens as any other
 * initializing one. Its archived time is only the time and does not decide this.
 * Test first: a workspace being restored opens; an archiving one cannot.
 * Route test first: an archived workspace's route stays; an archiving one's does not.
 */
import type { Workspace } from "./model.ts";
import { isArchivedWorkspace } from "./status/archived.ts";

/** True when the workspace's route can still open. */
export function canOpenWorkspace(workspace: Pick<Workspace, "state">): boolean {
	return !isArchivedWorkspace(workspace) && workspace.state !== "archiving";
}

/** True when the workspace's route stays on screen: live work, or an archived workspace shown read-only. */
export function canShowWorkspaceRoute(workspace: Pick<Workspace, "state">): boolean {
	return canOpenWorkspace(workspace) || isArchivedWorkspace(workspace);
}
