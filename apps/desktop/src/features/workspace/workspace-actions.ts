/**
 * @feature NAV-10 Workspace actions
 * Owns: the one call that restores an archived workspace.
 * Behaviour: ui-map.md 3.2 and 3.1 (Unarchive in the archived notice and in the actions menu).
 * Our design choice: Unarchive always keeps the current branch name and the chats, so both callers
 * ask for the same thing.
 * Must handle: the service refusing (the caller shows the toast, the button returns).
 * Test first: both the notice and the menu call workspaces.unarchive with the same options.
 */
import type { Result, WorkspaceId } from "@conducted/shared";
import type { Actions } from "../../core/api.ts";

export function unarchiveWorkspace(
	actions: Actions,
	workspaceId: WorkspaceId,
): Promise<Result<unknown>> {
	return actions.workspaces.unarchive(workspaceId, { branchName: null, clearChats: false });
}
