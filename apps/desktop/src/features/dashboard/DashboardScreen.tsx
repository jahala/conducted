/**
 * @feature NAV-06 Kanban dashboard
 * Owns: The Dashboard route: a board of workspaces in five status columns, with project filter
 * chips.
 * Behaviour: ui-map.md 2 (/dashboard: Backlog, In progress, In review, Done, Canceled; drag a card
 * to change status; project filter chips, top 5 plus more; empty: 'New workspace'; behind the
 * setting 'Dashboard').
 * Our design choice: The route is reachable only when the 'Dashboard' setting is on; with it off
 * the route shows a short explanation and a link to the setting.
 * Must handle: Setting off; loading; error; no workspaces ('New workspace' button); a column with
 * no cards shows its own quiet empty note; a failed status change returns the card to its column
 * and shows a toast; archived workspaces are not on the board.
 * Test first: Dropping a card on 'Done' calls workspaces.setKanbanStatus(id, 'done'); a failure
 * moves it back.
 */
import { notImplemented } from "@conducted/shared";

export function DashboardScreen(_props: Record<string, never>): never {
	return notImplemented("NAV-06");
}
