/**
 * @feature NAV-06 Kanban columns and grouping
 * Owns: The fixed list of board columns, the colour mark each status uses, the drag payload name,
 * and the pure function that puts workspaces into the columns.
 * Behaviour: ui-map.md 2 and 3.8 (Backlog, In progress, In review, Done, Canceled; each status has
 * its own colour token).
 * Our design choice: the column labels are the one home for the status names. The sidebar's status
 * groups and the Workspace actions menu read them from here. Colours come from the status tokens,
 * so the colour-vision palettes change them with the rest of the app.
 * Must handle: Every KanbanStatus has exactly one column (the record type enforces it); archived
 * workspaces are left out; inside a column cards are ordered by last activity, newest first.
 * Test first: Five workspaces with five different statuses give one card in each column.
 */
import type { KanbanStatus, Workspace } from "../../core/model.ts";

export const KANBAN_COLUMNS: Record<KanbanStatus, { label: string; position: number }> = {
	backlog: { label: "Backlog", position: 0 },
	in_progress: { label: "In progress", position: 1 },
	in_review: { label: "In review", position: 2 },
	done: { label: "Done", position: 3 },
	canceled: { label: "Canceled", position: 4 },
};

/** The statuses in board order. The one list the status menu and the sidebar's labels read. */
export const KANBAN_STATUSES: readonly KanbanStatus[] = (
	Object.keys(KANBAN_COLUMNS) as KanbanStatus[]
).sort((left, right) => KANBAN_COLUMNS[left].position - KANBAN_COLUMNS[right].position);

/** The mark a column and its cards use. A token, so colour-vision palettes and dark mode follow. */
export const KANBAN_STATUS_MARK: Record<KanbanStatus, string> = {
	backlog: "bg-status-backlog",
	in_progress: "bg-status-progress",
	in_review: "bg-status-review",
	done: "bg-status-done",
	canceled: "bg-status-canceled",
};

/** The drag-and-drop data type that carries a workspace id from a card to a column. */
export const KANBAN_DRAG_TYPE = "application/x-conducted-workspace";

/** True when a workspace belongs on the board: an archived one does not. */
function isOnBoard(workspace: Workspace): boolean {
	return workspace.state !== "archived" && workspace.archivedAt === null;
}

/**
 * Puts each workspace into its column. Archived workspaces are left out. Cards run newest first,
 * with the id as the stable tie-breaker so two workspaces with one activity time keep their order.
 */
export function groupByKanbanStatus(
	workspaces: readonly Workspace[],
): Record<KanbanStatus, Workspace[]> {
	const groups = Object.fromEntries(
		KANBAN_STATUSES.map((status) => [status, [] as Workspace[]]),
	) as Record<KanbanStatus, Workspace[]>;
	for (const workspace of workspaces) {
		if (!isOnBoard(workspace)) continue;
		groups[workspace.kanbanStatus].push(workspace);
	}
	for (const status of KANBAN_STATUSES) {
		groups[status].sort(
			(left, right) =>
				right.lastActivityAt - left.lastActivityAt || left.id.localeCompare(right.id),
		);
	}
	return groups;
}
