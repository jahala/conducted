/**
 * @feature NAV-05 Home empty states
 * Owns: what Home shows when the grid has no cards: no workspaces at all, or filters that match none.
 * Behaviour: ui-map.md 2 (Home empty: "No matching workspaces", "Create a workspace", "Clear filters"),
 * 7.2 (designed empty states).
 * Our design choice: when filters are active the one action is "Clear filters"; with no workspaces at all it is
 * "Create a workspace", the page's single primary action.
 * Must handle: filters active and no results; no workspaces and no filters; the archived filter on with no
 * archived workspaces ("Nothing is archived").
 * Test first: with filtersActive the button reads "Clear filters" and calls onClearFilters.
 */
import { Link } from "@tanstack/react-router";
import { Button, buttonClassName } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";

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
	if (filtersActive) {
		// Conductor's block (renderApp @10277012): a centred muted line and an outlined Clear filters.
		return (
			<div className="flex flex-col items-center gap-3 py-6 text-sm text-fg-muted">
				<h2 className="text-sm font-normal">
					{archivedOnly ? "Nothing is archived" : "No matching workspaces"}
				</h2>
				<p className="text-xs">Try a different search, or clear the filters to see everything.</p>
				<Button variant="outline" size="sm" onClick={onClearFilters}>
					Clear filters
				</Button>
			</div>
		);
	}
	return (
		<EmptyState
			title="No workspaces yet"
			body="Create one to give a task its own copy of the code and its own chats."
			action={
				<Link to="/create" className={buttonClassName({ variant: "default" })}>
					Create a workspace
				</Link>
			}
		/>
	);
}
