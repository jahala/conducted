/**
 * @feature NAV-06 Kanban columns and grouping
 * Owns: The fixed list of board columns and the pure function that puts workspaces into them.
 * Behaviour: ui-map.md 2 and 3.8 (Backlog, In progress, In review, Done, Canceled).
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

export function groupByKanbanStatus(_workspaces: Workspace[]): Record<KanbanStatus, Workspace[]> {
	return notImplemented("NAV-06");
}
