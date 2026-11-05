/**
 * @feature NAV-06 Kanban columns and grouping
 * Owns: The fixed list of board columns and the pure function that puts workspaces into them.
 * Behaviour: ui-map.md 2 and 3.8 (Backlog, In progress, In review, Done, Canceled).
 * Our design choice: the column labels are the one home for the status names. The sidebar's status
 * groups and the Workspace actions menu read them from here.
 * Must handle: Every KanbanStatus has exactly one column (the record type enforces it); archived
 * workspaces are left out; inside a column cards are ordered by last activity, newest first.
 * Test first: Five workspaces with five different statuses give one card in each column.
 */
import { notImplemented } from "@conducted/shared";
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

export function groupByKanbanStatus(_workspaces: Workspace[]): Record<KanbanStatus, Workspace[]> {
	return notImplemented("NAV-06");
}
