/**
 * @feature NAV-06 Kanban card
 * Owns: One draggable card: workspace name, repository, derived status text and line changes.
 * Behaviour: ui-map.md 2 (Dashboard cards), 3.8 (derived status).
 * Must handle: Dragging starts after a small move so a click still opens the workspace; the card is
 * also a link; a card being dragged is dimmed in place; focus ring.
 * Test first: Clicking the card without moving opens the workspace; moving it starts a drag.
 */
import { notImplemented } from "@conducted/shared";
import type { Repo, Workspace } from "../../core/model.ts";

export interface KanbanCardProps {
	workspace: Workspace;
	repo: Repo;
}

export function KanbanCard(_props: KanbanCardProps): never {
	return notImplemented("NAV-06");
}
