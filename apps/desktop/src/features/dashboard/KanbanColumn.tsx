/**
 * @feature NAV-06 Kanban column
 * Owns: One column of the board: a header with the status mark, name and count, its cards, the
 * drop target with its "Move to <column>" note, and "Show N more" past the first ten cards.
 * Behaviour: ui-map.md 2 (Dashboard columns), 3.8 (Kanban status is user-set and separate from the
 * derived status, each with its own colour token), 7.2 (a column with no cards stays an empty drop
 * target, as in Conductor). The 300px width, the ten-card limit with "Show N more" and "Show less",
 * and the "Move to <column>" note while a card is over the column are from Conductor's frontend
 * bundle.
 * Our design choice: Status is told by the column title next to its colour mark, never by hue alone.
 * The set of columns is in kanban.ts.
 * Must handle: Empty column (no text, still a drop target); a card dragged over the column shows
 * the note; keyboard users move a card with the card's status menu; a long column scrolls inside
 * itself.
 * Test first: Renders its title, the count and one card per workspace.
 */
import { useState } from "react";
import type { KanbanStatus, Repo, Workspace } from "../../core/model.ts";
import { cn } from "../../ui/cn.ts";
import type { PointerDrag } from "../../ui/pointer-drag.ts";
import { KanbanCard } from "./KanbanCard.tsx";
import { KANBAN_COLUMNS, KANBAN_STATUS_MARK } from "./kanban.ts";

/** Cards shown before the column offers "Show N more". */
export const KANBAN_COLUMN_LIMIT = 10;

export interface KanbanColumnProps {
	status: KanbanStatus;
	workspaces: Workspace[];
	repos: Repo[];
	/** Persist a drop or a menu choice; the screen rolls the card back when the write fails. */
	onMove: (workspaceId: Workspace["id"], status: KanbanStatus) => void;
	/** The board's drag, so a card starts one and this column is its target. */
	pointer: PointerDrag<Workspace, KanbanStatus>;
	/** The column's element, so the board can hit-test a pointer against it. */
	columnRef: (node: HTMLElement | null) => void;
}

export function KanbanColumn({
	status,
	workspaces,
	repos,
	onMove,
	pointer,
	columnRef,
}: KanbanColumnProps) {
	const [expanded, setExpanded] = useState(false);
	const over = pointer.drag?.target === status;
	const label = KANBAN_COLUMNS[status].label;
	const reposById = new Map(repos.map((repo) => [repo.id, repo]));
	const long = workspaces.length > KANBAN_COLUMN_LIMIT;
	const shown = expanded || !long ? workspaces : workspaces.slice(0, KANBAN_COLUMN_LIMIT);
	const hidden = workspaces.length - shown.length;

	return (
		<section
			ref={columnRef}
			aria-label={label}
			data-testid={`kanban-column-${status}`}
			className="relative flex min-h-0 w-[300px] shrink-0 flex-col"
		>
			<header className="flex shrink-0 items-center gap-2 px-2 pb-2">
				<span
					aria-hidden="true"
					className={cn("size-2 rounded-full", KANBAN_STATUS_MARK[status])}
				/>
				<h2 className="whitespace-nowrap text-sm font-medium text-fg">{label}</h2>
				<span className="text-xs tabular-nums text-fg-muted">{workspaces.length}</span>
			</header>
			<div className="relative flex min-h-0 flex-1">
				<ul
					aria-label={`${label} workspaces`}
					className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-2"
				>
					{shown.map((workspace) => {
						const repo = reposById.get(workspace.repoId);
						if (repo === undefined) return null;
						return (
							<li key={workspace.id}>
								<KanbanCard workspace={workspace} repo={repo} onMove={onMove} pointer={pointer} />
							</li>
						);
					})}
					{long ? (
						<li>
							<button
								type="button"
								onClick={() => setExpanded((value) => !value)}
								className="w-full rounded-sm py-1.5 text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
							>
								{expanded ? "Show less" : `Show ${hidden} more`}
							</button>
						</li>
					) : null}
				</ul>
				{over ? (
					<div className="pointer-events-none absolute inset-0 px-2 pb-2">
						<div className="flex size-full items-center justify-center rounded-md border border-border-strong bg-canvas/80">
							<span className="rounded-full border border-border-strong bg-raised px-3 py-1.5 text-sm font-medium text-fg shadow-xs">
								Move to {label}
							</span>
						</div>
					</div>
				) : null}
			</div>
		</section>
	);
}
