/**
 * @feature NAV-05 Home filters
 * Owns: The search box, project filter, active or archived toggle, sort and Display menu above the
 * grid.
 * Behaviour: ui-map.md 2 (Home: search, filters, sort, 'Display' card fields), 10 (display field
 * order not verified).
 * Must handle: Typing in search filters after a short pause, not on every key; 'Clear filters'
 * resets all but sort and Display; a project filter naming a removed repo is dropped; Escape in the
 * search box clears it.
 * Test first: Typing 'auth' calls onChange once with search 'auth' after the pause.
 */
import { notImplemented } from "@conducted/shared";
import type { Repo } from "../../core/model.ts";
import type { HomeFilterState } from "./home-query.ts";

export interface HomeFiltersProps {
	filters: HomeFilterState;
	repos: Repo[];
	onChange: (filters: HomeFilterState) => void;
}

export function HomeFilters(_props: HomeFiltersProps): never {
	return notImplemented("NAV-05");
}
