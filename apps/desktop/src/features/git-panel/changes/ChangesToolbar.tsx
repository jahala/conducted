/**
 * @feature REV-01 Changes toolbar
 * Owns: the row above the changed file list. A filter box, the flat or folder view toggle, and
 * the diff scope menu.
 * Behaviour: ui-map.md 3.6 ("Filter changed files", "Show flat list" or "Show folder hierarchy",
 * options menu for the diff scope).
 * Must handle: the filter being cleared with Escape, the view choice surviving restarts (a setting,
 * not component state), the scope menu showing which scope is active, and a narrow panel.
 * Test first: typing in the filter calls onFilterChange with the text, and Escape calls it with "".
 */
import type { WorkspaceId } from "@conducted/shared";
import type { DiffScope } from "../../../core/api.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import { FileTextIcon, FolderPlusIcon, SearchIcon } from "../../../ui/icons.tsx";
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
	return (
		<div className="flex shrink-0 items-center gap-1 border-b border-separator px-2 py-1">
			<div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-strong px-2">
				<SearchIcon className="shrink-0 text-fg-muted" />
				<input
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
			<IconButton
				label="Show flat list"
				size="sm"
				pressed={view === "flat"}
				variant={view === "flat" ? "secondary" : "ghost"}
				icon={<FileTextIcon />}
				onClick={() => onViewChange("flat")}
			/>
			<IconButton
				label="Show folder hierarchy"
				size="sm"
				pressed={view === "folders"}
				variant={view === "folders" ? "secondary" : "ghost"}
				icon={<FolderPlusIcon />}
				onClick={() => onViewChange("folders")}
			/>
			<DiffScopeMenu workspaceId={workspaceId} scope={scope} onChange={onScopeChange} />
		</div>
	);
}
