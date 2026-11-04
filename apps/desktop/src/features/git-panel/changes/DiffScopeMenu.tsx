/**
 * @feature REV-01 Diff scope menu
 * Owns: the menu that chooses what the Changes tab compares: the whole branch, a target branch,
 * only uncommitted changes, one commit, or one agent turn.
 * Behaviour: ui-map.md 3.6, Changes options menu; services-map.md 3.4.1 (what each scope diffs).
 * Data: useGitState for the branch, useBranchCommits for the commit entries and useBranches for
 * the target picker.
 * Entries, in order: Current branch, Target branch (opens TargetBranchPicker), All changes,
 * Uncommitted changes (Cmd+Alt+U, shows "N files changed"), then one entry per commit with its
 * message, short hash, author and date, and per-turn entries from the chat history.
 * Must handle: a branch with no commits ahead (commit list empty state), a very long commit list
 * (virtualised, newest first), a scope that no longer exists (a commit that was rewritten falls
 * back to the whole branch), and no upstream branch.
 * Test first: choosing a commit entry calls onChange with { kind: "commit", sha }.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { DiffScope } from "../../../core/api.ts";

export interface DiffScopeMenuProps {
	workspaceId: WorkspaceId;
	scope: DiffScope;
	onChange: (scope: DiffScope) => void;
}

export function DiffScopeMenu(_props: DiffScopeMenuProps): never {
	return notImplemented("REV-01");
}
