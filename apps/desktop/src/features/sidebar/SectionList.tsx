/**
 * @feature NAV-04 Sidebar sections
 * Owns: The user's named sections: header with name, emoji, count and actions, and the workspaces
 * inside.
 * Behaviour: ui-map.md 4 item 5 (sections from navigation_sections: name, optional emoji, collapse,
 * count, 'Create in section', 'New section...', rename, delete; errors 'Couldn't move workspace',
 * 'Couldn't reorder section', 'Couldn't delete section'), 5.3 (sidebar background menu: 'New
 * section...').
 * Must handle: Deleting a section moves its workspaces back to the main list; a failed move or
 * reorder shows a toast and the list returns to the saved order; a collapsed section is saved;
 * renaming to an empty name is refused; dragging a section header reorders sections.
 * Test first: Placing a workspace into a section calls sections.place with the section id and the
 * drop position; a failed call restores the previous order.
 */
import { notImplemented } from "@conducted/shared";
import type { Section, Workspace } from "../../core/model.ts";

export interface SectionListProps {
	sections: Section[];
	workspaces: Workspace[];
}

export function SectionList(_props: SectionListProps): never {
	return notImplemented("NAV-04");
}
