/**
 * @feature NAV-03 Sidebar grouping, filtering and sorting
 * Owns: The pure function that turns workspaces, repos and sections into the groups the sidebar
 * shows, plus the view options type and its saved form.
 * Behaviour: ui-map.md 4 items 4 to 7 (Pinned, sections, main list by status or project; manual
 * order per list).
 * Our design choice: A pure function with all inputs passed in, so it is tested without React or a
 * database. The main list's "status" groups are the user-set Kanban status (done, in review, in
 * progress, backlog, canceled), the order the research gives. Grouping by section needs NAV-04, so
 * the saved "section" value is kept apart and the caller shows an explicit note; it never quietly
 * shows projects instead.
 * Must handle: Pinned first; each workspace once; sections in their saved order; status groups in
 * the fixed status order; sort by last activity or creation time; manual order wins when on; ties
 * break by id so the order is stable; workspaces of hidden repos are left out; archived workspaces
 * are left out.
 * Test first: Three workspaces with mixed statuses and one pinned give Pinned, then status groups
 * in the fixed order, each sorted by last activity.
 */

import type { RepoId, WorkspaceId } from "@conducted/shared";
import type { KanbanStatus, Repo, Section, Workspace } from "../../core/model.ts";

export interface SidebarView {
	groupBy: "status" | "project";
	sortBy: "updated" | "created";
	/** When true the user's own order is used and sortBy is ignored. */
	manualOrder: boolean;
	/** Empty means all projects. */
	projectFilter: RepoId[];
}

export type SidebarGroupKey =
	| { kind: "pinned" }
	| { kind: "section"; sectionId: string }
	| { kind: "status"; status: string }
	| { kind: "project"; repoId: RepoId };

export interface SidebarGroup {
	key: SidebarGroupKey;
	label: string;
	workspaceIds: WorkspaceId[];
}

export interface SidebarViewInput {
	repos: Repo[];
	workspaces: Workspace[];
	sections: Section[];
	view: SidebarView;
	manualOrder: ReadonlyMap<string, WorkspaceId[]>;
}

/**
 * The stored `sidebar_group_by` value for each view mode. The settings registry also offers
 * "section"; NAV-04 owns that mode, so it is read on its own below.
 */
const GROUP_BY_SETTINGS = {
	project: "repo",
	status: "status",
} as const;

/**
 * Reads the saved group-by value. "section" comes back as itself so the caller can say it is not
 * available yet instead of showing projects under a different name. Any unknown value, including
 * none, falls back to the setting's default, projects.
 */
export function readGroupBySetting(stored: string): SidebarView["groupBy"] | "section" {
	if (stored === "section") return "section";
	const match = Object.entries(GROUP_BY_SETTINGS).find(([, value]) => value === stored);
	return (match?.[0] as SidebarView["groupBy"] | undefined) ?? "project";
}

/** The value to save for a view mode, so reading and writing share the table above. */
export function writeGroupBySetting(groupBy: SidebarView["groupBy"]): string {
	return GROUP_BY_SETTINGS[groupBy];
}

/** Every workspace id in the order the list shows them, for Cmd+1..9 and previous/next. */
export function orderedWorkspaceIds(groups: readonly SidebarGroup[]): WorkspaceId[] {
	return groups.flatMap((group) => group.workspaceIds);
}

/** The main-list status order Conductor shows: done first, then review, progress, backlog, canceled. */
export const SIDEBAR_STATUS_ORDER: readonly KanbanStatus[] = [
	"done",
	"in_review",
	"in_progress",
	"backlog",
	"canceled",
];

export const SIDEBAR_STATUS_LABELS: Record<KanbanStatus, string> = {
	done: "Done",
	in_review: "In review",
	in_progress: "In progress",
	backlog: "Backlog",
	canceled: "Canceled",
};

function orderKey(key: SidebarGroupKey): string {
	switch (key.kind) {
		case "pinned":
			return "pinned";
		case "section":
			return `section:${key.sectionId}`;
		case "status":
			return `status:${key.status}`;
		case "project":
			return `project:${key.repoId}`;
	}
}

function isArchived(workspace: Workspace): boolean {
	return workspace.state === "archived" || workspace.archivedAt !== null;
}

function dateOf(workspace: Workspace, sortBy: SidebarView["sortBy"]): number {
	return sortBy === "created" ? workspace.createdAt : workspace.lastActivityAt;
}

/** Newest first, with id as the stable tie-breaker. */
function compareWorkspaces(
	left: Workspace,
	right: Workspace,
	sortBy: SidebarView["sortBy"],
): number {
	const difference = dateOf(right, sortBy) - dateOf(left, sortBy);
	if (difference !== 0) return difference;
	return left.id.localeCompare(right.id);
}

/**
 * Sorts one group. With manual order on, the saved ids come first in their saved order; ids the
 * saved list no longer names follow in the chosen date order.
 */
function orderGroup(
	workspaces: Workspace[],
	key: SidebarGroupKey,
	input: SidebarViewInput,
): WorkspaceId[] {
	const sorted = [...workspaces].sort((left, right) =>
		compareWorkspaces(left, right, input.view.sortBy),
	);
	if (!input.view.manualOrder) return sorted.map((workspace) => workspace.id);
	const saved = input.manualOrder.get(orderKey(key)) ?? [];
	const byId = new Map(sorted.map((workspace) => [workspace.id, workspace]));
	const seen = new Set<WorkspaceId>();
	const ids: WorkspaceId[] = [];
	for (const id of saved) {
		if (!byId.has(id) || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	for (const workspace of sorted) {
		if (seen.has(workspace.id)) continue;
		ids.push(workspace.id);
	}
	return ids;
}

export function buildSidebarGroups(input: SidebarViewInput): SidebarGroup[] {
	const { repos, workspaces, sections, view } = input;
	const visibleRepos = repos.filter((repo) => !repo.hidden);
	const visibleRepoIds = new Set(visibleRepos.map((repo) => repo.id));
	const filter = new Set(view.projectFilter);
	const eligible = workspaces.filter(
		(workspace) =>
			!isArchived(workspace) &&
			visibleRepoIds.has(workspace.repoId) &&
			(filter.size === 0 || filter.has(workspace.repoId)),
	);

	const groups: SidebarGroup[] = [];
	const used = new Set<WorkspaceId>();

	const pinned = eligible.filter((workspace) => workspace.pinnedAt !== null);
	if (pinned.length > 0) {
		groups.push({
			key: { kind: "pinned" },
			label: "Pinned",
			workspaceIds: orderGroup(pinned, { kind: "pinned" }, input),
		});
		for (const workspace of pinned) used.add(workspace.id);
	}

	for (const section of [...sections].sort((left, right) => left.position - right.position)) {
		const members = new Set(section.workspaceIds);
		const inside = eligible.filter(
			(workspace) => members.has(workspace.id) && !used.has(workspace.id),
		);
		if (inside.length === 0) continue;
		const key: SidebarGroupKey = { kind: "section", sectionId: section.id };
		groups.push({
			key,
			label: section.name,
			workspaceIds: orderGroup(inside, key, input),
		});
		for (const workspace of inside) used.add(workspace.id);
	}

	const main = eligible.filter((workspace) => !used.has(workspace.id));

	if (view.groupBy === "status") {
		for (const status of SIDEBAR_STATUS_ORDER) {
			const inside = main.filter((workspace) => workspace.kanbanStatus === status);
			if (inside.length === 0) continue;
			const key: SidebarGroupKey = { kind: "status", status };
			groups.push({
				key,
				label: SIDEBAR_STATUS_LABELS[status],
				workspaceIds: orderGroup(inside, key, input),
			});
		}
		return groups;
	}

	const repoOrder = [...visibleRepos].sort(
		(left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name),
	);
	for (const repo of repoOrder) {
		if (filter.size > 0 && !filter.has(repo.id)) continue;
		const inside = main.filter((workspace) => workspace.repoId === repo.id);
		if (inside.length === 0) continue;
		const key: SidebarGroupKey = { kind: "project", repoId: repo.id };
		groups.push({
			key,
			label: repo.name,
			workspaceIds: orderGroup(inside, key, input),
		});
	}
	return groups;
}
