/**
 * @feature NAV-10 Workspace name
 * Owns: the one rule for the name a workspace is shown by, in the sidebar row, the header and the
 * rename dialog.
 * Behaviour: ui-map.md 4 (workspace row: name from the user-set name, PR title, branch or
 * directory), 3.1 (the header shows the same name).
 * Our design choice: a blank value counts as missing, so a workspace with an empty branch falls
 * through to its folder name everywhere instead of showing an empty title in one place.
 * Must handle: a name of only spaces (skipped); every field missing but the folder name.
 * Test first: a user-set name wins over the PR title, the branch and the folder; a blank branch
 * falls back to the folder name.
 */
import type { Workspace } from "../../core/model.ts";

export function workspaceName(
	workspace: Pick<Workspace, "displayName" | "prTitle" | "branch" | "directoryName">,
): string {
	return (
		workspace.displayName?.trim() ||
		workspace.prTitle?.trim() ||
		workspace.branch?.trim() ||
		workspace.directoryName
	);
}
