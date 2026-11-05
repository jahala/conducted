/**
 * @feature REV-01 Commit entries of the diff scope menu
 * Owns: the list of commits on the branch, each as a menu entry that selects the "one commit"
 * scope.
 * Behaviour: ui-map.md 3.6 ("per-commit entries (message, short hash, author, date)");
 * services-map.md 3.3.2 step 10 (the commit list is `target..HEAD`).
 * Must handle: no commits (explain that the branch has nothing ahead of the target), a long
 * subject line (one line, truncated, full text in a tooltip), dates in the user's locale, the
 * selected commit being marked, and arrow-key movement through the commits (the entries are menu
 * radio items, so this list must sit inside an open Menu).
 * Test first: three commits render in the order given and the selected one has aria-checked.
 */
import type { BranchCommit } from "../../../core/model.ts";
import { MenuRadioGroup, MenuRadioItem } from "../../../ui/Menu.tsx";

export interface CommitScopeListProps {
	commits: BranchCommit[];
	selectedSha: string | null;
	onSelect: (sha: string) => void;
}

const formatDate = (at: number): string =>
	new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function CommitScopeList({ commits, selectedSha, onSelect }: CommitScopeListProps) {
	if (commits.length === 0) {
		return (
			<p className="px-2 py-3 text-sm text-fg-muted">
				Nothing to show yet. This branch has no commits ahead of the target.
			</p>
		);
	}
	return (
		<MenuRadioGroup value={selectedSha ?? ""} aria-label="Commits">
			{commits.map((commit) => (
				<MenuRadioItem
					key={commit.sha}
					value={commit.sha}
					onSelect={() => onSelect(commit.sha)}
					className="w-full text-left"
				>
					<span className="block truncate" title={commit.subject}>
						{commit.subject}
					</span>
					<span className="block truncate text-xs text-fg-subtle">
						<span className="font-mono">{commit.shortSha}</span> · {commit.authorName} ·{" "}
						{formatDate(commit.at)}
					</span>
				</MenuRadioItem>
			))}
		</MenuRadioGroup>
	);
}
