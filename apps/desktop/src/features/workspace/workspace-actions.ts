/**
 * @feature NAV-10 Workspace actions
 * Owns: the one call that restores an archived workspace, with or without its chats.
 * Behaviour: ui-map.md 3.2 and 3.1 (Unarchive in the archived notice and in the actions menu), 4
 * (an archived card offers "Unarchive workspace" and "Clear & unarchive").
 * Our design choice: Unarchive keeps the current branch name and the chats unless the caller asks
 * for a branch name or for "Clear & unarchive", so every caller shares one signature.
 * Must handle: the service refusing (the caller shows the toast, the button returns); a caller
 * supplying a branch name after the service asked for one.
 * Test first: both the notice and the menu call workspaces.unarchive with the same options.
 */
import type { Result, WorkspaceId } from "@conducted/shared";
import type { Actions, UnarchiveOutcome } from "../../core/api.ts";

export function unarchiveWorkspace(
	actions: Actions,
	workspaceId: WorkspaceId,
	branchName: string | null = null,
	clearChats = false,
): Promise<Result<UnarchiveOutcome>> {
	return actions.workspaces.unarchive(workspaceId, { branchName, clearChats });
}

/** "Clear & unarchive": removes the workspace's chats before it comes back. */
export function clearAndUnarchiveWorkspace(
	actions: Actions,
	workspaceId: WorkspaceId,
): Promise<Result<UnarchiveOutcome>> {
	return unarchiveWorkspace(actions, workspaceId, null, true);
}
