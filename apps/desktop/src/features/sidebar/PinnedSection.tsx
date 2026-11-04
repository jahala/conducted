/**
 * @feature NAV-04 Pinned section
 * Owns: The collapsible Pinned group at the top of the list, and its drop target.
 * Behaviour: ui-map.md 4 item 4 (Pinned: collapsible, count when collapsed, drop target 'Drag a
 * workspace here', aria 'Pinned workspaces').
 * Must handle: Empty and nothing is being dragged (hidden); empty and a drag is in progress (show
 * the drop hint); collapsed (show the count); a drop of an archived workspace is refused; the drop
 * calls workspaces.setPinned and the service stores the order.
 * Test first: Dropping a workspace on the section calls setPinned(id, true).
 */
import { notImplemented } from "@conducted/shared";
import type { Workspace } from "../../core/model.ts";

export interface PinnedSectionProps {
	workspaces: Workspace[];
}

export function PinnedSection(_props: PinnedSectionProps): never {
	return notImplemented("NAV-04");
}
