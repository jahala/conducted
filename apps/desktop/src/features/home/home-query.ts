/**
 * @feature NAV-05 Home filtering, sorting and paging
 * Owns: The pure function that applies Home's search, project filter, archived toggle and sort, and
 * cuts the result into pages of 50.
 * Behaviour: ui-map.md 2 (Home: search, filters for projects and active or archived, sort, paging
 * by 50, pinned group).
 * Our design choice: Search matches the display name, branch, PR title and repository name,
 * ignoring case and accents. Pinned workspaces form their own first group.
 * Must handle: Empty search (no filtering); archived toggle shows only archived; a page past the
 * end gives an empty list; sorting is stable; the total count is returned so the UI can say how
 * many are hidden.
 * Test first: Searching 'AUTH' finds a workspace whose branch is 'fix-auth-bug'; page 2 of 60
 * results has 10 items.
 */

import type { RepoId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Repo, Workspace } from "../../core/model.ts";

export interface HomeFilterState {
	search: string;
	projects: RepoId[];
	archivedOnly: boolean;
	sortBy: "updated" | "created";
}

export interface HomePage {
	pinned: Workspace[];
	items: Workspace[];
	total: number;
	hasMore: boolean;
}

export function queryHome(_props: {
	workspaces: Workspace[];
	repos: Repo[];
	filters: HomeFilterState;
	pageCount: number;
}): HomePage {
	return notImplemented("NAV-05");
}
