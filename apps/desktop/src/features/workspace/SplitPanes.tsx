/**
 * @feature NAV-10 Split panes
 * Owns: The centre as a tree of tab groups, so tabs can sit side by side or stacked.
 * Behaviour: ui-map.md 3.2 (with the setting 'Split tabs' the strip becomes a tree of groups; tabs
 * drag between groups or to an edge to split; a ghost follows the cursor; Cmd+D split is registered
 * but hidden).
 * Our design choice: Off by default, behind a setting, as in Conductor. The tree model is in
 * tab-layout.ts. One group is the normal case and must cost nothing.
 * Must handle: Dropping a tab on an edge splits; closing the last tab of a group removes the group
 * and merges its neighbour; sizes between groups are resizable and saved; a layout that names a tab
 * that no longer exists is repaired; a workspace with the setting off ignores any saved split.
 * Test first: Dropping a tab on the right edge of a group makes two groups with the tab alone in
 * the new one.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface SplitPanesProps {
	workspaceId: WorkspaceId;
	search: WorkspaceSearch;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function SplitPanes(_props: SplitPanesProps): never {
	return notImplemented("NAV-10");
}
