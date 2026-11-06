/**
 * @feature NAV-06 Kanban column
 * Owns: One column of the board: header with name and count, a list of cards, the drop target, and
 * the quiet note an empty column shows.
 * Behaviour: ui-map.md 2 (Dashboard columns), 3.8 (Kanban status is user-set and separate from the
 * derived status), 7.2 (designed empty states).
 * Our design choice: Status is told by the column title, a colour token and the card's own text,
 * never by hue alone. The set of columns is in kanban.ts.
 * Must handle: Empty column; a card dragged over the column highlights the drop target; keyboard
 * users move a card with the card menu; very long columns scroll inside the column.
 * Test first: Renders its title, the count and one card per workspace.
 */
import { useState } from "react";
import type { KanbanStatus, Repo, Workspace } from "../../core/model.ts";
import { cn } from "../../ui/cn.ts";
import { KANBAN_COLUMNS, KANBAN_DRAG_TYPE, KANBAN_STATUS_MARK } from "./kanban.ts";
import { KanbanCard } from "./KanbanCard.tsx";

export interface KanbanColumnProps {
	status: KanbanStatus;
	workspaces: Workspace[];
	repos: Repo[];
	/** Persist a drop or a menu choice; the screen rolls the card back when the write fails. */
	onMove: (workspaceId: Workspace["id"], status: KanbanStatus) => void;
}

export function KanbanColumn({ status, workspaces, repos, onMove }: KanbanColumnProps) {
	const [over, setOver] = useState(false);
	const label = KANBAN_COLUMNS[status].label;
	const reposById = new Map(repos.map((repo) => [repo.id, repo]));

	const drop = (event: React.DragEvent<HTMLElement>) => {
		event.preventDefault();
		setOver(false);
		const workspaceId = event.dataTransfer.getData(KANBAN_DRAG_TYPE);
		if (workspaceId === "") return;
		onMove(workspaceId as Workspace["id"], status);
	};

	return (
		<section
			aria-label={label}
			data-testid={`kanban-column-${status}`}
			data-over={over ? "true" : "false"}
			onDragOver={(event) => {
				event.preventDefault();
				if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={drop}
			className={cn(
				"flex min-h-0 flex-col rounded-lg border border-border bg-surface",
				over && "border-accent bg-hover",
			)}
		>
			<header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				<span aria-hidden="true" className={cn("size-2 rounded-full", KANBAN_STATUS_MARK[status])} />
				<h2 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{label}</h2>
				<span className="text-xs tabular-nums text-fg-muted">{workspaces.length}</span>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{workspaces.length === 0 ? (
					<p className="px-2 py-3 text-xs text-fg-subtle">No workspaces here</p>
				) : (
					<ul aria-label={`${label} workspaces`} className="flex flex-col gap-2">
						{workspaces.map((workspace) => {
							const repo = reposById.get(workspace.repoId);
							if (repo === undefined) return null;
							return (
								<li key={workspace.id}>
									<KanbanCard workspace={workspace} repo={repo} onMove={onMove} />
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</section>
	);
}
