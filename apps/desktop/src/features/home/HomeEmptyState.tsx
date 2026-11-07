/**
 * @feature NAV-05 Home empty states
 * Owns: what Home shows when the grid has no cards: no workspaces at all, or filters that match none.
 * Behaviour: ui-map.md 2 (Home empty: "No matching workspaces", "Create a workspace", "Clear filters"),
 * 7.2 (designed empty states).
 * Structure: Conductor's one compact block for both cases, "No matching workspaces" and the action.
 * Our design choice: when filters are active the one action is "Clear filters"; with no workspaces at all it is
 * "Create a workspace", the page's single primary action. There is no hint line under the title, as in
 * Conductor (D098).
 * Must handle: filters active and no results; no workspaces and no filters; the archived filter on with no
 * archived workspaces ("Nothing is archived").
 * Test first: with filtersActive the button reads "Clear filters" and calls onClearFilters.
 */
import { Link } from "@tanstack/react-router";
import { Button, buttonClassName } from "../../ui/Button.tsx";

export interface HomeEmptyStateProps {
	filtersActive: boolean;
	archivedOnly: boolean;
	onClearFilters: () => void;
}

export function HomeEmptyState({
	filtersActive,
	archivedOnly,
	onClearFilters,
}: HomeEmptyStateProps) {
	// Conductor's block (renderApp @10277012): a centred muted line, then Clear filters (outlined)
	// when filters are on, or Create a workspace when there is nothing to show.
	return (
		<div className="flex flex-col items-center gap-3 py-6 text-sm text-fg-muted">
			<h2 className="text-sm font-normal">
				{filtersActive && archivedOnly ? "Nothing is archived" : "No matching workspaces"}
			</h2>
			{filtersActive ? (
				<Button variant="outline" size="sm" onClick={onClearFilters}>
					Clear filters
				</Button>
			) : (
				<Link to="/create" className={buttonClassName({ variant: "default", size: "sm" })}>
					Create a workspace
				</Link>
			)}
		</div>
	);
}
