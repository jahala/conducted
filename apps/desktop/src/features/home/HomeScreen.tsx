/**
 * @feature NAV-05 Home
 * Owns: The Home route: a card grid of all workspaces with search, filters, sort, a Display menu, a
 * pinned group and paging.
 * Behaviour: ui-map.md 2 (/all-workspaces: search, filters for projects and active or archived,
 * sort, 'Display' card fields, pinned group, paging by 50; empty: 'No matching workspaces').
 * Our design choice: Owner filters, routine origin and team avatars are cloud features and are left
 * out. Card fields to choose from: repository, repository icon, line changes, last active (cost is
 * added when usage is stored per workspace).
 * Must handle: Loading (skeleton cards, role status); error with retry; no workspaces; filters that
 * match nothing; archived filter (cards offer Unarchive, Open in Finder, Copy path); more than 50
 * results (a 'Show more' control); filters and sort kept when leaving and returning; the header is
 * a window drag region and starts with the title bar inset.
 * Test first: With 60 workspaces the first page shows 50 cards and 'Show more' shows the rest.
 */
import { notImplemented } from "@conducted/shared";

export function HomeScreen(_props: Record<string, never>): never {
	return notImplemented("NAV-05");
}
