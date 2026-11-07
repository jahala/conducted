/**
 * @feature NAV-10 Workspace name
 * Owns: the one rule for the name a workspace is shown by (the sidebar row, Home, the palette, the
 * dashboard, the rename dialog), and the branch as the header shows it.
 * Behaviour: ui-map.md 4 (workspace row: name from the user-set name, PR title, branch or
 * directory). Conductor's rule (main bundle, the workspace display name): the user's name, then the
 * PR title, then the branch unless it is a placeholder or the target branch, else the folder name.
 * A branch or folder name loses the user's branch prefix, its dashes and underscores become spaces
 * and its first letter is capitalised ("sam/fix-login-redirect" is "Fix login redirect"). The header
 * shows the branch without the prefix and otherwise as it is ("fix-login-redirect").
 * Our design choice: a blank value counts as missing. The target branch may carry its remote
 * ("origin/main"), so a branch equal to its last part counts as the target branch.
 * Must handle: a name of only spaces (skipped); a branch with another user's prefix (kept, as
 * Conductor strips only the current prefix); no prefix ("").
 * Test first: a user-set name wins over the PR title, the branch and the folder; a branch is shown
 * without the user's prefix, in words.
 */
import type { Workspace } from "../../core/model.ts";

/** The branch without the user's branch prefix, as the workspace header shows it. */
export function branchWithoutPrefix(branch: string, branchPrefix: string): string {
	return branchPrefix !== "" && branch.startsWith(branchPrefix)
		? branch.slice(branchPrefix.length)
		: branch;
}

function inWords(name: string, branchPrefix: string): string {
	const words = branchWithoutPrefix(name, branchPrefix).replace(/[-_]/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function isTargetBranch(branch: string, targetBranch: string): boolean {
	return branch === targetBranch || targetBranch.endsWith(`/${branch}`);
}

export function workspaceName(
	workspace: Pick<
		Workspace,
		"displayName" | "prTitle" | "branch" | "branchIsPlaceholder" | "targetBranch" | "directoryName"
	>,
	branchPrefix: string,
): string {
	const own = workspace.displayName?.trim() || workspace.prTitle?.trim();
	if (own) return own;
	const branch = workspace.branch.trim();
	if (
		branch !== "" &&
		!workspace.branchIsPlaceholder &&
		!isTargetBranch(branch, workspace.targetBranch)
	) {
		return inWords(branch, branchPrefix);
	}
	return inWords(workspace.directoryName, branchPrefix);
}
