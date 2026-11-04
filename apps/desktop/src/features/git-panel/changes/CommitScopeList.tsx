/**
 * @feature REV-01 Commit entries of the diff scope menu
 * Owns: the list of commits on the branch, each as a menu entry that selects the "one commit"
 * scope.
 * Behaviour: ui-map.md 3.6 ("per-commit entries (message, short hash, author, date)");
 * services-map.md 3.3.2 step 10 (the commit list is `target..HEAD`).
 * Must handle: no commits (explain that the branch has nothing ahead of the target), a long
 * subject line (one line, truncated, full text in a tooltip), dates in the user's locale, and the
 * selected commit being marked.
 * Test first: three commits render in the order given and the selected one has aria-checked.
 */
import { notImplemented } from "@conducted/shared";
import type { BranchCommit } from "../../../core/model.ts";

export interface CommitScopeListProps {
	commits: BranchCommit[];
	selectedSha: string | null;
	onSelect: (sha: string) => void;
}

export function CommitScopeList(_props: CommitScopeListProps): never {
	return notImplemented("REV-01");
}
