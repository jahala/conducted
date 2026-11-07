/**
 * @feature NAV-05 Home filtering, sorting and paging
 * Owns: the pure function that applies Home's search, project filter, archive filter and sort, and
 * grows the visible result by one page of 50 per request; the display fields a card may show.
 * Behaviour: ui-map.md 2 (Home: search, filters for projects and active or archived, sort, paging
 * by 50, pinned group), 10 (the fields seen on Home cards).
 * Our design choice: search matches the display name, branch, PR title and repository name,
 * ignoring case and accents. Pinned workspaces form their own first group and are not paged. The
 * total counts the unpaged matches, so the screen can say how many are hidden. Paging is
 * cumulative: `pageCount` 2 returns the first 100 unpinned matches, so "Show more" only adds
 * cards. The archived rule is `isArchivedWorkspace` in core, so the archive filter agrees with
 * every other screen while a workspace is restored.
 * Must handle: empty search (no filtering); the archive filter hides archived workspaces, shows all,
 * or shows only archived ones; name and repository sorts ignore case;
 * asking for more pages than exist returns every match; sorting is stable; a project filter naming
 * a removed repository is harmless because a workspace's repository still decides the match.
 * Test first: searching "AUTH" finds a workspace whose branch is "fix-auth-bug"; asking for two
 * pages of 60 results returns all 60.
 */

import type { RepoId } from "@conducted/shared";
import type { Repo, Workspace } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { workspaceName } from "../workspace/workspace-name.ts";

/** Conductor's archive filter: "Hiding archived", "Showing all", "Only archived". */
export type HomeArchiveFilter = "active" | "all" | "archived";
/** Conductor's sorts: "Last active", "Newest", "Name", "Repository". */
export type HomeSort = "lastActive" | "created" | "name" | "repository";

export interface HomeFilterState {
	search: string;
	projects: RepoId[];
	archive: HomeArchiveFilter;
	sortBy: HomeSort;
}

/** One page holds this many workspaces before "Show more" appears. */
export const HOME_PAGE_SIZE = 50;

/** An optional field the Display menu can hide or show on a card. */
export const HOME_DISPLAY_FIELDS = [
	"repository",
	"repositoryIcon",
	"lineChanges",
	"lastActive",
] as const;
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

/**
 * Dates sort newest first; name and repository sort A to Z, with the last activity next. The id is
 * the stable tie-breaker.
 */
function compareWorkspaces(
	left: Workspace,
	right: Workspace,
	sortBy: HomeSort,
	repoName: (workspace: Workspace) => string,
	branchPrefix: string,
): number {
	const text =
		sortBy === "name"
			? workspaceName(left, branchPrefix).localeCompare(
					workspaceName(right, branchPrefix),
					undefined,
					{
						sensitivity: "base",
					},
				)
			: sortBy === "repository"
				? repoName(left).localeCompare(repoName(right), undefined, { sensitivity: "base" })
				: 0;
	if (text !== 0) return text;
	const difference =
		sortBy === "created"
			? right.createdAt - left.createdAt
			: right.lastActivityAt - left.lastActivityAt;
	if (difference !== 0) return difference;
	return left.id.localeCompare(right.id);
}

export function queryHome({
	workspaces,
	repos,
	filters,
	pageCount,
	branchPrefix,
}: {
	workspaces: Workspace[];
	repos: Repo[];
	filters: HomeFilterState;
	pageCount: number;
	/** The user's branch prefix, which workspace names drop (sorting by name). */
	branchPrefix: string;
}): HomePage {
	const reposById = new Map(repos.map((repo) => [repo.id, repo]));
	const projects = new Set(filters.projects);
	const needle = normalise(filters.search.trim());

	const matching = workspaces
		.filter((workspace) => {
			if (filters.archive === "active" && isArchivedWorkspace(workspace)) return false;
			if (filters.archive === "archived" && !isArchivedWorkspace(workspace)) return false;
			if (projects.size > 0 && !projects.has(workspace.repoId)) return false;
			return matchesSearch(workspace, reposById.get(workspace.repoId), needle);
		})
		.sort((left, right) =>
			compareWorkspaces(
				left,
				right,
				filters.sortBy,
				(workspace) => reposById.get(workspace.repoId)?.name ?? "",
				branchPrefix,
			),
		);

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
