/**
 * @feature NAV-10 Workspace actions menu
 * Owns: The one menu of workspace actions, used by the header's 'Workspace actions' button and the
 * sidebar row's context menu.
 * Behaviour: ui-map.md 3.1 ('Workspace actions' menu: mark as read or unread, pin or unpin, set
 * status, move to section, rename, copy link, archive or unarchive).
 * Our design choice: One list, two surfaces: the items come from a single function so both menus
 * always agree. Cloud items (follow, reassign, share) are left out. Shortcut hints come from the
 * command registry.
 * Must handle: Archived workspace (Unarchive instead of Archive, no Rename); a destructive item
 * (Archive) asks for confirmation when the workspace has uncommitted changes; move to section lists
 * sections and 'New section...'; a failed action shows a toast.
 * Test first: Choosing Pin calls workspaces.setPinned(id, true); for a pinned workspace the item
 * reads Unpin.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";

export interface WorkspaceActionsMenuProps {
	workspaceId: WorkspaceId;
	/** The button or row that opens the menu. */
	children: ReactNode;
	surface: "dropdown" | "context";
}

export function WorkspaceActionsMenu(_props: WorkspaceActionsMenuProps): never {
	return notImplemented("NAV-10");
}
