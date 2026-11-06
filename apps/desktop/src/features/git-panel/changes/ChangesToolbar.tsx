/**
 * @feature REV-01 Changes toolbar
 * Owns: the row above the changed file list. A filter box, the flat or folder view toggle, and
 * the diff scope menu.
 * Behaviour: ui-map.md 3.6 ("Filter changed files", "Show flat list" or "Show folder hierarchy",
 * options menu for the diff scope).
 * Must handle: the filter being cleared with Escape, the flat or folder view being switched, the
 * scope menu showing which scope is active, and a narrow panel.
 * Test first: typing in the filter calls onFilterChange with the text, and Escape calls it with "".
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import type { DiffScope } from "../../../core/api.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import { FileTextIcon, FolderIcon, SearchIcon } from "../../../ui/icons.tsx";
import { DiffScopeMenu } from "./DiffScopeMenu.tsx";

export interface ChangesToolbarProps {
	workspaceId: WorkspaceId;
	filter: string;
	onFilterChange: (filter: string) => void;
	view: "flat" | "folders";
	onViewChange: (view: "flat" | "folders") => void;
	scope: DiffScope;
	onScopeChange: (scope: DiffScope) => void;
}

export function ChangesToolbar({
	workspaceId,
	filter,
	onFilterChange,
	view,
	onViewChange,
	scope,
	onScopeChange,
}: ChangesToolbarProps) {
	// Conductor keeps the filter behind a search icon; it stays open while it holds text.
	const [searching, setSearching] = useState(false);
	const showFilter = searching || filter.length > 0;
	return (
		<div className="flex h-9 shrink-0 items-center gap-1 border-b border-separator px-2">
			{showFilter ? (
				<div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-strong px-2">
					<SearchIcon className="shrink-0 text-fg-muted" />
					<input
						// biome-ignore lint/a11y/noAutofocus: the field opens because the user asked to search.
						autoFocus={searching}
						onBlur={() => setSearching(false)}
						value={filter}
						onChange={(event) => onFilterChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								onFilterChange("");
							}
						}}
						placeholder="Filter changed files"
						aria-label="Filter changed files"
						className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
					/>
				</div>
			) : (
				<>
					<span className="flex-1" />
					<IconButton
						label="Search changed files"
						size="sm"
						variant="ghost"
						icon={<SearchIcon className="size-3.5" />}
						onClick={() => setSearching(true)}
					/>
				</>
			)}
			<IconButton
				label={view === "flat" ? "Show folder hierarchy" : "Show flat list"}
				size="sm"
				variant="ghost"
				icon={
					view === "flat" ? (
						<FolderIcon className="size-3.5" />
					) : (
						<FileTextIcon className="size-3.5" />
					)
				}
				onClick={() => onViewChange(view === "flat" ? "folders" : "flat")}
			/>
			<DiffScopeMenu workspaceId={workspaceId} scope={scope} onChange={onScopeChange} />
		</div>
	);
}
