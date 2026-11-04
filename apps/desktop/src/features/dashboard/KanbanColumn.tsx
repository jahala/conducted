/**
 * @feature NAV-06 Kanban column
 * Owns: One column of the board: header with name and count, a list of cards, and the drop target.
 * Behaviour: ui-map.md 2 (Dashboard columns), 3.8 (Kanban status is user-set and separate from the
 * derived status).
 * Our design choice: Status is told by the column title and a shape, not by hue alone. The set of
 * columns is in kanban.ts.
 * Must handle: Empty column; a card dragged over the column highlights the drop target; keyboard
 * users move a card with the card menu; very long columns scroll inside the column.
 * Test first: Renders its title, the count and one card per workspace.
 */
import { notImplemented } from "@conducted/shared";
import type { KanbanStatus, Repo, Workspace } from "../../core/model.ts";

export interface KanbanColumnProps {
	status: KanbanStatus;
	workspaces: Workspace[];
	repos: Repo[];
}

export function KanbanColumn(_props: KanbanColumnProps): never {
	return notImplemented("NAV-06");
}
