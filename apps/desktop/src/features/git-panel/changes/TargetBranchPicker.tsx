/**
 * @feature REV-01 Target branch picker
 * Owns: a searchable list of branches. It is used by the diff scope menu to compare against a
 * branch, and by the header to change the workspace's target branch (GIT-08).
 * Behaviour: ui-map.md 3.6 ("Select target branch..."); services-map.md 3.6.6 (remote branch list,
 * newest first, without HEAD) and 3.11 (retarget).
 * Must handle: loading the branch list (it fetches), offline (use cached remote branches and say
 * so), no match for the query, the current target marked, and branches checked out in another
 * worktree (shown, not selectable as a checkout target).
 * Test first: typing "rel" narrows ["main", "release/1"] to the second entry.
 */
import { useId, useState } from "react";
import { SearchIcon } from "../../../ui/icons.tsx";
import { menuItemClass } from "../../../ui/Menu.tsx";

export interface TargetBranchPickerProps {
	branches: string[];
	current: string;
	onSelect: (branch: string) => void;
	loading: boolean;
	offline: boolean;
}

export function TargetBranchPicker({
	branches,
	current,
	onSelect,
	loading,
	offline,
}: TargetBranchPickerProps) {
	const [query, setQuery] = useState("");
	const listId = useId();
	const needle = query.trim().toLowerCase();
	const matches =
		needle.length === 0 ? branches : branches.filter((b) => b.toLowerCase().includes(needle));

	return (
		<div className="w-64">
			<div className="flex h-8 items-center gap-2 rounded-md border border-border-strong px-2">
				<SearchIcon className="shrink-0 text-fg-muted" />
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => event.stopPropagation()}
					placeholder="Select target branch..."
					aria-label="Select target branch"
					aria-controls={listId}
					className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
				/>
			</div>
			{offline ? (
				<p className="px-2 pt-2 text-xs text-fg-subtle">
					Offline: showing the branches from the last fetch.
				</p>
			) : null}
			<div
				id={listId}
				role="listbox"
				aria-label="Branches"
				className="mt-1 max-h-64 overflow-y-auto"
			>
				{loading ? (
					<p role="status" className="px-2 py-2 text-sm text-fg-subtle">
						Loading branches
					</p>
				) : matches.length === 0 ? (
					<p className="px-2 py-2 text-sm text-fg-muted">No branches match</p>
				) : (
					matches.map((branch) => (
						<button
							key={branch}
							type="button"
							role="option"
							aria-selected={branch === current}
							onClick={() => onSelect(branch)}
							className={`${menuItemClass} w-full text-left`}
						>
							<span className="flex-1 truncate font-mono text-xs">{branch}</span>
							{branch === current ? <span className="text-xs text-fg-muted">Current</span> : null}
						</button>
					))
				)}
			</div>
		</div>
	);
}
