/**
 * @feature NAV-03 Grouped workspace list
 * Owns: Showing the sidebar's workspaces in groups: Pinned, the user's sections, then the main list
 * grouped by status or by project.
 * Behaviour: ui-map.md 4 items 4 to 7 and the View options menu (group by Status or Project, filter
 * by project, sort by Updated or Created).
 * Our design choice: The view options (group, filter, sort) are kept in a setting so they survive a
 * restart. Status groups run in this order: done, in review, in progress, backlog, canceled, the
 * order Conductor uses. The user's own sections come from NAV-04 and are left out until that
 * feature is built; pinned and the main groups work without them. The row actions menu comes from
 * NAV-10 and is left out here for the same reason.
 * Must handle: A workspace in two places (pinned and in a section) shows once, in Pinned; a group
 * with no workspaces is hidden; a collapsed group shows its count; a project filter that matches
 * nothing shows a short empty note with a way to clear it; archived workspaces are never listed;
 * the selected workspace stays visible after a re-sort.
 * Test first: Given three workspaces in two repos, grouping by project gives two groups; pinning
 * one moves it to Pinned and removes it from its group.
 */

import type { WorkspaceId } from "@conducted/shared";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useActions, useSetting } from "../../core/hooks.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/Collapsible.tsx";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "../../ui/icons.tsx";
import { buildSidebarGroups, type SidebarGroup, type SidebarView } from "./sidebar-view.ts";
import { ViewOptionsMenu } from "./ViewOptionsMenu.tsx";
import { WorkspaceRow } from "./WorkspaceRow.tsx";

export interface GroupedWorkspacesProps {
	repos: Repo[];
	workspaces: Workspace[];
}

const NO_MANUAL_ORDER = new Map<string, WorkspaceId[]>();

function readView(
	groupBy: string,
	sortBy: string,
	projectFilter: string,
	manualOrder: boolean,
): SidebarView {
	return {
		groupBy: groupBy === "status" ? "status" : "project",
		sortBy: sortBy === "created" ? "created" : "updated",
		manualOrder,
		projectFilter:
			projectFilter === "" ? [] : (projectFilter.split(",") as SidebarView["projectFilter"]),
	};
}

function GroupSection({
	group,
	rows,
	repos,
	selectedId,
	shortcutIndexes,
}: {
	group: SidebarGroup;
	rows: Map<WorkspaceId, { workspace: Workspace; repo: Repo }>;
	repos: Repo[];
	selectedId: WorkspaceId | null;
	shortcutIndexes: ReadonlyMap<WorkspaceId, number>;
}) {
	const [open, setOpen] = useState(true);
	const repoId = group.key.kind === "project" ? group.key.repoId : null;
	const repo =
		repoId === null ? null : (repos.find((candidate) => candidate.id === repoId) ?? null);
	return (
		<section aria-label={group.label} className="mb-1">
			<div className="group/header flex items-center gap-1 px-2">
				<Collapsible open={open} onOpenChange={setOpen}>
					<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-sidebar-fg-muted hover:bg-hover hover:text-fg">
						{open ? <ChevronDownIcon /> : <ChevronRightIcon />}
						<span className="truncate">{group.label}</span>
						{open ? null : (
							<span className="ml-1 text-2xs text-fg-subtle">{group.workspaceIds.length}</span>
						)}
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="flex flex-col gap-0.5 py-0.5">
							{group.workspaceIds.map((workspaceId) => {
								const row = rows.get(workspaceId);
								if (row === undefined) return null;
								return (
									<WorkspaceRow
										key={workspaceId}
										workspace={row.workspace}
										repo={row.repo}
										selected={selectedId === workspaceId}
										shortcutIndex={shortcutIndexes.get(workspaceId) ?? null}
									/>
								);
							})}
						</div>
					</CollapsibleContent>
				</Collapsible>
				{repo === null ? null : (
					<Link
						to="/create"
						aria-label={`Create workspace in ${repo.name}`}
						title={`Create workspace in ${repo.name}`}
						className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
					>
						<PlusIcon />
					</Link>
				)}
			</div>
		</section>
	);
}

export function GroupedWorkspaces({ repos, workspaces }: GroupedWorkspacesProps) {
	const actions = useActions();
	const groupBy = useSetting<string>("sidebar_group_by");
	const sortBy = useSetting<string>("sidebar_sort_by");
	const projectFilter = useSetting<string>("sidebar_repo_filter");
	const manualOrder = useSetting<boolean>("manual_workspace_order");
	const params = useParams({ strict: false });
	const selectedId = (params as { workspaceId?: WorkspaceId }).workspaceId ?? null;

	const existingRepoIds = useMemo(() => new Set(repos.map((repo) => repo.id)), [repos]);
	const view = useMemo(() => {
		const parsed = readView(groupBy, sortBy, projectFilter, manualOrder);
		return {
			...parsed,
			projectFilter: parsed.projectFilter.filter((repoId) => existingRepoIds.has(repoId)),
		};
	}, [groupBy, sortBy, projectFilter, manualOrder, existingRepoIds]);

	const groups = useMemo(
		() =>
			buildSidebarGroups({
				repos,
				workspaces,
				sections: [],
				statuses: new Map(),
				view,
				manualOrder: NO_MANUAL_ORDER,
			}),
		[repos, workspaces, view],
	);

	const rows = useMemo(() => {
		const repoById = new Map(repos.map((repo) => [repo.id, repo]));
		const result = new Map<WorkspaceId, { workspace: Workspace; repo: Repo }>();
		for (const workspace of workspaces) {
			const repo = repoById.get(workspace.repoId);
			if (repo !== undefined) result.set(workspace.id, { workspace, repo });
		}
		return result;
	}, [repos, workspaces]);

	const shortcutIndexes = useMemo(() => {
		const result = new Map<WorkspaceId, number>();
		let index = 0;
		for (const group of groups) {
			for (const workspaceId of group.workspaceIds) {
				index += 1;
				if (index <= 9) result.set(workspaceId, index);
			}
		}
		return result;
	}, [groups]);

	const changeView = (next: SidebarView) => {
		void actions.settings.set("sidebar_group_by", next.groupBy === "status" ? "status" : "repo");
		void actions.settings.set("sidebar_sort_by", next.sortBy);
		void actions.settings.set("sidebar_repo_filter", next.projectFilter.join(","));
	};

	const clearFilter = () => changeView({ ...view, projectFilter: [] });

	return (
		<div className="flex flex-col">
			<div className="flex h-8 shrink-0 items-center justify-end px-2">
				<ViewOptionsMenu view={view} repos={repos} onChange={changeView} />
			</div>
			{groups.length === 0 ? (
				<div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-fg-muted">
					<p>No matching workspaces</p>
					{view.projectFilter.length > 0 ? (
						<Button variant="secondary" size="sm" onClick={clearFilter}>
							Clear filter
						</Button>
					) : null}
				</div>
			) : (
				groups.map((group) => (
					<GroupSection
						key={
							group.key.kind === "project"
								? `project:${group.key.repoId}`
								: group.key.kind === "status"
									? `status:${group.key.status}`
									: group.key.kind === "section"
										? `section:${group.key.sectionId}`
										: "pinned"
						}
						group={group}
						rows={rows}
						repos={repos}
						selectedId={selectedId}
						shortcutIndexes={shortcutIndexes}
					/>
				))
			)}
		</div>
	);
}
