/**
 * @feature NAV-03 View options menu
 * Owns: The sort icon menu above the list: Group by (Status or Project), Filter by project, Sort by
 * (Updated or Created).
 * Behaviour: ui-map.md 4 (View options menu; the project filter is searchable from 5 repos; Sort by
 * is hidden when manual order is on).
 * Must handle: Manual order on (hide Sort by); fewer than 5 repos (no search box in the filter); a
 * filter that names a removed repo is dropped; the menu shows the current choice with a check mark.
 * Test first: Choosing Group by Project calls onChange with groupBy 'project'; Sort by is absent
 * when manualOrder is true.
 */
import { notImplemented } from "@conducted/shared";
import type { Repo } from "../../core/model.ts";
import type { SidebarView } from "./sidebar-view.ts";

export interface ViewOptionsMenuProps {
	view: SidebarView;
	repos: Repo[];
	onChange: (view: SidebarView) => void;
}

export function ViewOptionsMenu(_props: ViewOptionsMenuProps): never {
	return notImplemented("NAV-03");
}
