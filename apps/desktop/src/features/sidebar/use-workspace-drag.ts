/**
 * @feature NAV-04 Workspace drag and drop
 * Owns: The drag and drop behaviour for sidebar rows: dragging a workspace into Pinned or a
 * section, and reordering when manual order is on.
 * Behaviour: ui-map.md 4 ('Drag and drop: workspaces drag into sections, Pinned, or reorder when
 * Arrange workspaces manually is on'; while dragging the cursor is 'grabbing' and link pointer
 * events are off).
 * Our design choice: No drag and drop library is installed. This hook starts on the browser's
 * native drag events. If native events are too coarse for reordering, a library (for example
 * dnd-kit, MIT) is a decision for the owner.
 * Must handle: Drag cancelled with Escape (nothing changes); drop outside any target (nothing
 * changes); a drag over a collapsed section opens it after a short pause; keyboard users can move a
 * row with the row menu (Move to section); the drop result is stored once, and a late result for an
 * older drag is dropped.
 * Test first: Dropping row A after row B in manual order calls the order action with A after B and
 * not before.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface WorkspaceDragState {
	draggingId: WorkspaceId | null;
	overTarget: string | null;
}

export interface WorkspaceDragHandlers {
	state: WorkspaceDragState;
	startDrag: (id: WorkspaceId) => void;
	dropOn: (target: string, position: number) => void;
	cancel: () => void;
}

export function useWorkspaceDrag(): WorkspaceDragHandlers {
	return notImplemented("NAV-04");
}
