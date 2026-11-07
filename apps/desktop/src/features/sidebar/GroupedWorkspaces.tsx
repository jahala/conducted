/**
 * @feature NAV-03 Grouped workspace list
 * Owns: Showing the sidebar's workspaces in the order the user sees them: Pinned, the user's
 * sections, then the main list grouped by status or by project.
 * Behaviour: ui-map.md 4 items 4 to 7 and the View options menu (group by Status or Project, filter
 * by project, sort by Updated or Created; manual order when it is on). The list opens with
 * Conductor's "My workspaces" header, whose hover ellipsis holds that menu (renderApp @10494900).
 * Our design choice: the header does not collapse the list; whether Conductor's local list
 * collapses from it is not settled by the bundle.
 * Our design choice: The view options (group, filter, sort) are kept in a setting so they survive a
 * restart. Status groups run in this order: done, in review, in progress, backlog, canceled, the
 * order Conductor uses. Pinned and the user's sections are rendered by PinnedSection and
 * SectionList, which own their drag targets; this component supplies their data and the saved
 * manual order. A row dragged within a main group saves its new order in the `sidebar_manual_order`
 * setting. The row's right-click actions menu comes from NAV-10.
 * Must handle: A workspace in two places (pinned and in a section) shows once, in Pinned; a group
 * with no workspaces is hidden; a collapsed group shows its count; a project filter that matches
 * nothing shows a short empty note with a way to clear it; archived workspaces are never listed;
 * the selected workspace stays visible after a re-sort; Cmd+1..9 and Cmd+Alt+ArrowUp/Down move
 * through the visible order, wrapping at the ends; a right click on the list offers "New section...".
 * The collapsed state of the main groups lives here so the visible order can leave them out; a row
 * the user cannot see gets no shortcut number. The "+" on a project header carries the project to the
 * create page as the search param `repo`.
 * Test first: Given three workspaces in two repos, grouping by project gives two groups; pinning
 * one moves it to Pinned and removes it from its group.
 */

import type { Result, WorkspaceId } from "@conducted/shared";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCommandHandler, useRunCommandHandlers } from "../../app/command-dispatcher.ts";
import { useActions, useSetting } from "../../core/hooks.ts";
import type { Repo, Section, Workspace } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/Collapsible.tsx";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { KANBAN_STATUS_MARK } from "../dashboard/kanban.ts";
import { AddProjectMenu } from "./AddProjectButton.tsx";
import { PinnedSection } from "./PinnedSection.tsx";
import { RepoAvatar } from "./RepoAvatar.tsx";
import { SectionDialog } from "./SectionDialog.tsx";
import { SectionList } from "./SectionList.tsx";
import { HeaderChevron, HeaderCount } from "./section-header.tsx";
import {
	buildSidebarGroups,
	orderedWorkspaceIds,
	readGroupBySetting,
	type SidebarGroup,
	type SidebarView,
	writeGroupBySetting,
} from "./sidebar-view.ts";
import {
	draggedSection,
	draggedWorkspace,
	useWorkspaceDrag,
	WORKSPACE_DRAG_MIME,
} from "./use-workspace-drag.ts";
import { ViewOptionsMenu } from "./ViewOptionsMenu.tsx";
import { WorkspaceRow } from "./WorkspaceRow.tsx";

export interface GroupedWorkspacesProps {
	repos: Repo[];
	workspaces: Workspace[];
	/** The user's sections, from the sections service. */
	sections?: readonly Section[];
}

/** The saved per-list order: group key to workspace ids. */
function readManualOrder(stored: string): Map<string, WorkspaceId[]> {
	const result = new Map<string, WorkspaceId[]>();
	if (stored.trim() === "") return result;
	try {
		const parsed: unknown = JSON.parse(stored);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return result;
		for (const [key, value] of Object.entries(parsed)) {
			if (!Array.isArray(value)) continue;
			const ids = value.filter((id): id is WorkspaceId => typeof id === "string");
			if (ids.length > 0) result.set(key, ids);
		}
	} catch {
		// A hand-edited value that is not JSON: show the saved sort instead of failing the sidebar.
		return result;
	}
	return result;
}

function writeManualOrder(
	current: ReadonlyMap<string, WorkspaceId[]>,
	key: string,
	ids: readonly WorkspaceId[],
): string {
	const next: Record<string, WorkspaceId[]> = {};
	for (const [entryKey, entryIds] of current) next[entryKey] = [...entryIds];
	next[key] = [...ids];
	return JSON.stringify(next);
}

function readView(
	groupBy: SidebarView["groupBy"],
	sortBy: string,
	projectFilter: string,
	manualOrder: boolean,
): SidebarView {
	return {
		groupBy,
		sortBy: sortBy === "created" ? "created" : "updated",
		manualOrder,
		projectFilter:
			projectFilter === "" ? [] : (projectFilter.split(",") as SidebarView["projectFilter"]),
	};
}

function groupKey(group: SidebarGroup): string {
	switch (group.key.kind) {
		case "project":
			return `project:${group.key.repoId}`;
		case "status":
			return `status:${group.key.status}`;
		case "section":
			return `section:${group.key.sectionId}`;
		case "pinned":
			return "pinned";
	}
}

function GroupSection({
	group,
	rows,
	repos,
	selectedId,
	shortcutIndexes,
	manualOrder,
	open,
	onOpenChange,
	onReorder,
}: {
	group: SidebarGroup;
	rows: Map<WorkspaceId, { workspace: Workspace; repo: Repo }>;
	repos: Repo[];
	selectedId: WorkspaceId | null;
	shortcutIndexes: ReadonlyMap<WorkspaceId, number>;
	manualOrder: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onReorder: (orderedIds: readonly WorkspaceId[]) => Promise<Result<unknown>> | undefined;
}) {
	const actions = useActions();
	const repoId = group.key.kind === "project" ? group.key.repoId : null;
	const repo =
		repoId === null ? null : (repos.find((candidate) => candidate.id === repoId) ?? null);
	const drag = useWorkspaceDrag({
		order: group.workspaceIds,
		sectionId: null,
		manualOrder,
		place: (workspaceId, sectionId, position) =>
			actions.sections.place(workspaceId, sectionId, position),
		reorder: onReorder,
		onError: toastError,
	});
	return (
		<section aria-label={group.label} className="px-1.5 pt-1.5 pb-3">
			<Collapsible open={open} onOpenChange={onOpenChange}>
				<div className="group/header mt-0.5 mb-1 flex items-center gap-0.5">
					<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left text-sm font-semibold text-sidebar-fg-muted hover:bg-hover">
						{repo !== null ? (
							<span className="relative flex size-4 shrink-0 items-center justify-center">
								<span className="group-hover/header:invisible">
									<RepoAvatar repo={repo} />
								</span>
								<span className="invisible absolute inset-0 flex items-center justify-center group-hover/header:visible">
									{open ? (
										<ChevronDownIcon className="size-3" />
									) : (
										<ChevronRightIcon className="size-3" />
									)}
								</span>
							</span>
						) : group.key.kind === "status" ? (
							<span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
								<span className={cn("size-2 rounded-full", KANBAN_STATUS_MARK[group.key.status])} />
							</span>
						) : null}
						<span className="min-w-0 truncate">{group.label}</span>
						<HeaderCount open={open} count={group.workspaceIds.length} variant="group" />
						{repo === null ? <HeaderChevron open={open} variant="group" /> : null}
					</CollapsibleTrigger>
					{repo === null ? null : (
						<Link
							to="/create"
							search={{ repo: repo.id }}
							aria-label={`Create workspace in ${repo.name}`}
							title={`Create workspace in ${repo.name}`}
							className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-fg-muted hover:bg-hover hover:text-fg"
						>
							<PlusIcon className="size-4" />
						</Link>
					)}
				</div>
				<CollapsibleContent>
					<div className="flex flex-col gap-1">
						{group.workspaceIds.map((workspaceId) => {
							const row = rows.get(workspaceId);
							if (row === undefined) return null;
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: a sidebar row is a drag source; its link is the interactive part.
								<div
									key={workspaceId}
									draggable
									data-workspace-id={workspaceId}
									onDragStart={(event) => {
										event.dataTransfer?.setData(WORKSPACE_DRAG_MIME, workspaceId);
										event.dataTransfer?.setData("text/plain", workspaceId);
										drag.startDrag(workspaceId);
									}}
									onDragEnd={drag.cancel}
									onDragOver={(event) => {
										event.preventDefault();
										event.stopPropagation();
										drag.dragOver(`row:${workspaceId}`);
									}}
									onDrop={(event) => {
										event.preventDefault();
										event.stopPropagation();
										if (draggedSection(event) !== null) return;
										const carried = draggedWorkspace(event, drag.state.draggingId);
										if (carried === null) return;
										drag.dropOn(`row:${workspaceId}`, 1, carried);
									}}
								>
									<WorkspaceRow
										workspace={row.workspace}
										repo={row.repo}
										selected={selectedId === workspaceId}
										shortcutIndex={shortcutIndexes.get(workspaceId) ?? null}
										showRepo={group.key.kind !== "project"}
										indent="grouped"
									/>
								</div>
							);
						})}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
}

export function GroupedWorkspaces({ repos, workspaces, sections = [] }: GroupedWorkspacesProps) {
	const actions = useActions();
	const navigate = useNavigate();
	const groupBy = useSetting<string>("sidebar_group_by");
	const sortBy = useSetting<string>("sidebar_sort_by");
	const projectFilter = useSetting<string>("sidebar_repo_filter");
	const manualOrderSetting = useSetting<boolean>("manual_workspace_order");
	const storedManualOrder = useSetting<string>("sidebar_manual_order");
	const params = useParams({ strict: false });
	const selectedId = (params as { workspaceId?: WorkspaceId }).workspaceId ?? null;
	const [newSectionOpen, setNewSectionOpen] = useState(false);
	const runCommand = useRunCommandHandlers();
	const groupByMode = readGroupBySetting(groupBy);
	const groupByView = groupByMode === "section" ? "project" : groupByMode;

	const existingRepoIds = useMemo(() => new Set(repos.map((repo) => repo.id)), [repos]);
	const view = useMemo(() => {
		const parsed = readView(groupByView, sortBy, projectFilter, manualOrderSetting);
		return {
			...parsed,
			projectFilter: parsed.projectFilter.filter((repoId) => existingRepoIds.has(repoId)),
		};
	}, [groupByView, sortBy, projectFilter, manualOrderSetting, existingRepoIds]);

	const manualOrder = useMemo(() => readManualOrder(storedManualOrder), [storedManualOrder]);

	const groups = useMemo(
		() =>
			buildSidebarGroups({
				repos,
				workspaces,
				sections: [...sections],
				view,
				manualOrder,
			}),
		[repos, workspaces, sections, view, manualOrder],
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

	const pinnedGroup = groups.find((group) => group.key.kind === "pinned");
	const pinnedIds = useMemo(
		() => new Set<WorkspaceId>(pinnedGroup?.workspaceIds ?? []),
		[pinnedGroup],
	);
	const pinnedWorkspaces = (pinnedGroup?.workspaceIds ?? [])
		.map((workspaceId) => rows.get(workspaceId)?.workspace)
		.filter((workspace): workspace is Workspace => workspace !== undefined);

	const mainGroups = groups.filter(
		(group) => group.key.kind === "status" || group.key.kind === "project",
	);

	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	const setGroupOpen = (key: string, open: boolean) => {
		setCollapsed((previous) => {
			if (open) {
				if (!previous.has(key)) return previous;
				const next = new Set(previous);
				next.delete(key);
				return next;
			}
			if (previous.has(key)) return previous;
			return new Set(previous).add(key);
		});
	};

	const ordered = useMemo(() => {
		const visible = groups.filter((group) => {
			const key = group.key;
			if (key.kind === "section") {
				const sectionId = key.sectionId;
				const section = sections.find((candidate) => candidate.id === sectionId);
				return section !== undefined && !section.collapsed;
			}
			if (key.kind === "status" || key.kind === "project") {
				return !collapsed.has(groupKey(group));
			}
			return true;
		});
		return orderedWorkspaceIds(visible);
	}, [groups, sections, collapsed]);

	const shortcutIndexes = useMemo(() => {
		const result = new Map<WorkspaceId, number>();
		for (const [index, workspaceId] of ordered.entries()) {
			if (index < 9) result.set(workspaceId, index + 1);
		}
		return result;
	}, [ordered]);

	const currentIndex = selectedId === null ? -1 : ordered.indexOf(selectedId);

	const goToIndex = (index: number): boolean => {
		const workspaceId = ordered[index];
		if (workspaceId === undefined) return false;
		const row = rows.get(workspaceId);
		if (row === undefined) return false;
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: row.repo.id, workspaceId: row.workspace.id },
		});
		return true;
	};

	const goToPrevious = (): boolean => {
		if (ordered.length === 0) return false;
		return goToIndex(currentIndex <= 0 ? ordered.length - 1 : currentIndex - 1);
	};

	const goToNext = (): boolean => {
		if (ordered.length === 0) return false;
		return goToIndex(
			currentIndex === -1 || currentIndex === ordered.length - 1 ? 0 : currentIndex + 1,
		);
	};

	useCommandHandler("workspace.switch1", "base", () => goToIndex(0));
	useCommandHandler("workspace.switch2", "base", () => goToIndex(1));
	useCommandHandler("workspace.switch3", "base", () => goToIndex(2));
	useCommandHandler("workspace.switch4", "base", () => goToIndex(3));
	useCommandHandler("workspace.switch5", "base", () => goToIndex(4));
	useCommandHandler("workspace.switch6", "base", () => goToIndex(5));
	useCommandHandler("workspace.switch7", "base", () => goToIndex(6));
	useCommandHandler("workspace.switch8", "base", () => goToIndex(7));
	useCommandHandler("workspace.switch9", "base", () => goToIndex(8));
	useCommandHandler("workspace.previous", "base", goToPrevious);
	useCommandHandler("workspace.next", "base", goToNext);

	const changeView = (next: SidebarView) => {
		const writes: [string, unknown][] = [];
		if (next.groupBy !== groupByMode) {
			writes.push(["sidebar_group_by", writeGroupBySetting(next.groupBy)]);
		}
		if (next.sortBy !== view.sortBy) {
			writes.push(["sidebar_sort_by", next.sortBy]);
		}
		if (next.projectFilter.join(",") !== view.projectFilter.join(",")) {
			writes.push(["sidebar_repo_filter", next.projectFilter.join(",")]);
		}
		for (const [key, value] of writes) {
			void actions.settings.set(key, value).then((result) => {
				if (!result.ok) toastError("Couldn't save the sidebar view", result.error);
			});
		}
	};

	const saveOrder = (key: string) => (ids: readonly WorkspaceId[]) =>
		actions.settings.set("sidebar_manual_order", writeManualOrder(manualOrder, key, ids));

	const clearFilter = () => changeView({ ...view, projectFilter: [] });

	return (
		<ContextMenu
			items={
				<ContextMenuItem onSelect={() => setNewSectionOpen(true)}>New section...</ContextMenuItem>
			}
		>
			<div className="flex flex-col" data-sidebar-list="">
				{/* Conductor's list header (Rtr, renderApp @10494900): "My workspaces" in 12px semibold
				    muted text, its actions behind an ellipsis that shows on hover (D098). */}
				<div className="group/header relative mt-0.5 px-2">
					<div className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 group-hover/header:bg-hover">
						<h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-sidebar-fg-muted">
							My workspaces
						</h2>
						<span aria-hidden="true" className="w-6 shrink-0" />
					</div>
					<ViewOptionsMenu
						view={view}
						repos={repos}
						onChange={changeView}
						onNewSection={() => setNewSectionOpen(true)}
						onAddProject={() => runCommand("project.add")}
					/>
					<AddProjectMenu />
				</div>
				<PinnedSection
					workspaces={pinnedWorkspaces}
					allWorkspaces={workspaces}
					onReorder={saveOrder("pinned")}
				/>
				<SectionList
					sections={sections}
					workspaces={workspaces}
					excludedIds={pinnedIds}
					onNewSection={() => setNewSectionOpen(true)}
				/>
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
					mainGroups.map((group) => {
						const key = groupKey(group);
						return (
							<GroupSection
								key={key}
								group={group}
								rows={rows}
								repos={repos}
								selectedId={selectedId}
								shortcutIndexes={shortcutIndexes}
								manualOrder={view.manualOrder}
								open={!collapsed.has(key)}
								onOpenChange={(open) => setGroupOpen(key, open)}
								onReorder={saveOrder(key)}
							/>
						);
					})
				)}
				<SectionDialog open={newSectionOpen} onOpenChange={setNewSectionOpen} section={null} />
			</div>
		</ContextMenu>
	);
}
