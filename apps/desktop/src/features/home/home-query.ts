/**
 * @feature NAV-05 Home filtering, sorting and paging
 * Owns: the pure function that applies Home's search, project filter, archived toggle and sort, and
 * cuts the result into pages of 50; the display fields a card may show.
 * Behaviour: ui-map.md 2 (Home: search, filters for projects and active or archived, sort, paging
 * by 50, pinned group), 10 (the fields seen on Home cards).
 * Our design choice: search matches the display name, branch, PR title and repository name,
 * ignoring case and accents. Pinned workspaces form their own first group and are not paged. The
 * total counts the unpaged matches, so the screen can say how many are hidden.
 * Must handle: empty search (no filtering); the archived toggle shows only archived workspaces;
 * a page past the end gives an empty list; sorting is stable; a project filter naming a removed
 * repository is harmless because a workspace's repository still decides the match.
 * Test first: searching "AUTH" finds a workspace whose branch is "fix-auth-bug"; page 2 of 60
 * results has 10 items.
 */

import type { RepoId } from "@conducted/shared";
import type { Repo, Workspace } from "../../core/model.ts";

export interface HomeFilterState {
	search: string;
	projects: RepoId[];
	archivedOnly: boolean;
	sortBy: "updated" | "created";
}

/** One page holds this many workspaces before "Show more" appears. */
export const HOME_PAGE_SIZE = 50;

/** An optional field the Display menu can hide or show on a card. */
export const HOME_DISPLAY_FIELDS = ["repository", "lastActive"] as const;
export type HomeDisplayField = (typeof HOME_DISPLAY_FIELDS)[number];
export type HomeDisplay = ReadonlySet<HomeDisplayField>;

/** A fresh default set, so one card's change never mutates another test's or screen's set. */
export function defaultHomeDisplay(): HomeDisplay {
	return new Set(HOME_DISPLAY_FIELDS);
}

export interface HomePage {
	/** Matching pinned workspaces, newest first. Never paged. */
	pinned: Workspace[];
	/** The matching unpinned workspaces for the requested pages, newest first. */
	items: Workspace[];
	/** How many unpinned workspaces match, for "Show more" and the hidden count. */
	total: number;
	hasMore: boolean;
}

/** Lower case and strip accents, so "Café" matches "cafe". */
function normalise(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

function isArchived(workspace: Workspace): boolean {
	return workspace.state === "archived" || workspace.archivedAt !== null;
}

function matchesSearch(workspace: Workspace, repo: Repo | undefined, needle: string): boolean {
	if (needle === "") return true;
	return [workspace.displayName, workspace.branch, workspace.prTitle, repo?.name].some(
		(value) =>
			value !== null &&
			value !== undefined &&
			normalise(value) !== "" &&
			normalise(value).includes(needle),
	);
}

function dateOf(workspace: Workspace, sortBy: HomeFilterState["sortBy"]): number {
	return sortBy === "created" ? workspace.createdAt : workspace.lastActivityAt;
}

/** Newest first, with the id as the stable tie-breaker. */
function compareWorkspaces(
	left: Workspace,
	right: Workspace,
	sortBy: HomeFilterState["sortBy"],
): number {
	const difference = dateOf(right, sortBy) - dateOf(left, sortBy);
	if (difference !== 0) return difference;
	return left.id.localeCompare(right.id);
}

export function queryHome({
	workspaces,
	repos,
	filters,
	pageCount,
}: {
	workspaces: Workspace[];
	repos: Repo[];
	filters: HomeFilterState;
	pageCount: number;
}): HomePage {
	const reposById = new Map(repos.map((repo) => [repo.id, repo]));
	const projects = new Set(filters.projects);
	const needle = normalise(filters.search.trim());

	const matching = workspaces
		.filter((workspace) => {
			if (filters.archivedOnly !== isArchived(workspace)) return false;
			if (projects.size > 0 && !projects.has(workspace.repoId)) return false;
			return matchesSearch(workspace, reposById.get(workspace.repoId), needle);
		})
		.sort((left, right) => compareWorkspaces(left, right, filters.sortBy));

	const pinned = matching.filter((workspace) => workspace.pinnedAt !== null);
	const unpinned = matching.filter((workspace) => workspace.pinnedAt === null);
	const pageSize = HOME_PAGE_SIZE * Math.max(0, Math.floor(pageCount));
	const items = unpinned.slice(0, pageSize);

	return {
		pinned,
		items,
		total: unpinned.length,
		hasMore: items.length < unpinned.length,
	};
}
