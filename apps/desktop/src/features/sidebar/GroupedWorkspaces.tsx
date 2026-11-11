/**
 * @feature NAV-03 Grouped workspace list
 * Owns: Showing the sidebar's workspaces in the order the user sees them: Pinned, the user's
 * sections, then the main list grouped by status or by project.
 * Behaviour: ui-map.md 4 items 4 to 7 and the View options menu (group by Status or Project, filter
 * by project, sort by Updated or Created; manual order when it is on). The list opens with
 * Conductor's "My workspaces" header, whose hover ellipsis holds that menu (renderApp @10494900).
 * The header is Conductor's button (`Rtr`, @10493990) and folds the main list: aria-expanded, a
 * right chevron while folded, a down chevron on hover or focus while open, and its own remembered
 * fold, saved as `sidebar_my_workspaces_collapsed`.
 * Our design choice: The view options (group, filter, sort) are kept in a setting so they survive a
 * restart. Status groups run in this order: done, in review, in progress, backlog, canceled, the
 * order Conductor uses. Pinned and the user's sections are rendered by PinnedSection and
 * SectionList, which own their drag targets; this component supplies their data and the saved
 * manual order. A row dragged within a main group saves its new order in the `sidebar_manual_order`
 * setting. A project group header dragged onto another saves the project order through
 * `Actions.projects.reorder` (NAV-04), the way Conductor reorders its project groups. The row's
 * right-click actions menu comes from NAV-10.
 * Must handle: A workspace in two places (pinned and in a section) shows once, in Pinned; in project
 * grouping every project that is not hidden keeps its group and its +, with or without workspaces,
 * as in Conductor's local organisation; a status group with no workspaces is hidden; a main group
 * starts closed unless it holds the open workspace, and the user's toggle then wins, as in Conductor
 * (renderApp's sidebar groups); a collapsed group shows its count; when no group is left, a short
 * empty note with a way to clear the filter; archived workspaces are never listed;
 * the selected workspace stays visible after a re-sort; Cmd+1..9 and Cmd+Alt+ArrowUp/Down move
 * through the visible order, wrapping at the ends; a right click on the list offers "New section...".
 * The collapsed state of the main groups lives here so the visible order can leave them out; a row
 * the user cannot see gets no shortcut number. The "+" on a project header carries the project to the
 * create page as the search param `repo`. The row menu's Create section, Archive and Copy link
 * commands are registered here for the selected workspace, so their shortcuts and the palette
 * reach the same actions as the menu (workspace.createSection, workspace.archive, workspace.copyLink).
 * Test first: Given three workspaces in two repos, grouping by project gives two groups; pinning
 * one moves it to Pinned and removes it from its group; dragging one project header onto another
 * saves the new project order.
 */

import type { RepoId, Result, WorkspaceId } from "@conducted/shared";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useCommandHandler, useRunCommandHandlers } from "../../app/command-dispatcher.ts";
import { useActions, useSetting } from "../../core/hooks.ts";
import type { Repo, Section, Workspace } from "../../core/model.ts";
import { buildDeepLink } from "../../core/notifications.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
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
import { useWorkspaceDrag } from "./use-workspace-drag.ts";
import { ViewOptionsMenu } from "./ViewOptionsMenu.tsx";
import { WorkspaceRow } from "./WorkspaceRow.tsx";
import {
	useWorkspaceDragController,
	useWorkspaceHitTest,
	WorkspaceDragProvider,
} from "./workspace-drag-context.tsx";

/** True when a point lies inside a rectangle. jsdom gives every element a zero rectangle. */
function containsPoint(rect: DOMRect, point: { x: number; y: number }): boolean {
	return (
		point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
	);
}

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
	repoReorderable,
	onReorderRepo,
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
	/** True when this project header is one of several that can be dragged into a new order. */
	repoReorderable: boolean;
	onReorderRepo: (draggedId: string, targetId: string) => void;
}) {
	const actions = useActions();
	const pointer = useWorkspaceDragController();
	const sectionRef = useRef<HTMLElement | null>(null);
	const repoId = group.key.kind === "project" ? group.key.repoId : null;
	const repo =
		repoId === null ? null : (repos.find((candidate) => candidate.id === repoId) ?? null);
	const canReorderRepo = repoReorderable && repo !== null;
	const drag = useWorkspaceDrag({
		order: group.workspaceIds,
		sectionId: null,
		manualOrder,
		place: (workspaceId, sectionId, position) =>
			actions.sections.place(workspaceId, sectionId, position),
		reorder: onReorder,
		onError: toastError,
	});
	useWorkspaceHitTest((point) => {
		const root = sectionRef.current;
		if (root === null) return undefined;
		for (const row of root.querySelectorAll<HTMLElement>("[data-workspace-id]")) {
			const rect = row.getBoundingClientRect();
			if (!containsPoint(rect, point)) continue;
			const workspaceId = row.dataset.workspaceId as WorkspaceId | undefined;
			if (workspaceId === undefined) continue;
			return {
				key: `row:${workspaceId}`,
				element: row,
				drop: (payload, at) => {
					if (payload.kind !== "workspace") return;
					const after = rect.height > 0 && at.y > rect.top + rect.height / 2;
					drag.dropOn(`row:${workspaceId}`, after ? 1 : 0, payload.id);
				},
			};
		}
		if (!canReorderRepo || repo === null) return undefined;
		const header = root.querySelector<HTMLElement>("[data-repo-id]");
		if (header === null) return undefined;
		const rect = header.getBoundingClientRect();
		if (!containsPoint(rect, point)) return undefined;
		return {
			key: `repo:${repo.id}`,
			element: header,
			drop: (payload) => {
				if (payload.kind === "repo" && payload.id !== repo.id) {
					onReorderRepo(payload.id, repo.id);
				}
			},
		};
	});
	return (
		<section ref={sectionRef} aria-label={group.label} className="px-1.5 pt-1.5 pb-3">
			<Collapsible open={open} onOpenChange={onOpenChange}>
				<div
					className="group/header mt-0.5 mb-1 flex touch-none items-center gap-0.5"
					data-repo-id={repo?.id}
					onClickCapture={pointer.consumeClick}
					onPointerDown={(event) => {
						if (!canReorderRepo || repo === null) return;
						pointer.start(event, { kind: "repo", id: repo.id });
					}}
				>
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
								<div
									key={workspaceId}
									data-workspace-id={workspaceId}
									className="touch-none"
									onClickCapture={pointer.consumeClick}
									onPointerDown={(event) => {
										drag.startDrag(workspaceId);
										pointer.start(event, { kind: "workspace", id: workspaceId });
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
	const myWorkspacesCollapsed = useSetting<boolean>("sidebar_my_workspaces_collapsed");
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
	const projectGroupCount = mainGroups.filter((group) => group.key.kind === "project").length;

	// The user's own open or closed choice per main group. A group the user has not toggled starts
	// closed unless it holds the open workspace, as in Conductor (renderApp's sidebar groups).
	const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
	const isCollapsed = useCallback(
		(group: SidebarGroup): boolean =>
			chosen.get(groupKey(group)) ??
			!(selectedId !== null && group.workspaceIds.includes(selectedId)),
		[chosen, selectedId],
	);
	const setGroupOpen = (key: string, open: boolean) => {
		setChosen((previous) => new Map(previous).set(key, !open));
	};

	const ordered = useMemo(() => {
		const visible = groups.filter((group) => {
			const key = group.key;
			if (key.kind === "section") {
				const sectionId = key.sectionId;
				const section = sections.find((candidate) => candidate.id === sectionId);
				return section !== undefined && !section.collapsed;
			}
			if (key.kind === "status" || key.kind === "project") return !isCollapsed(group);
			return true;
		});
		return orderedWorkspaceIds(visible);
	}, [groups, sections, isCollapsed]);

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

	// The list owns the selected workspace, so the row menu's commands also run from a shortcut or
	// the palette, not only from a right click (Cmd+Shift+A archive, Cmd+Shift+C copy link).
	useCommandHandler("workspace.createSection", "base", () => {
		setNewSectionOpen(true);
		return true;
	});
	useCommandHandler("workspace.archive", "base", () => {
		if (selectedId === null) return false;
		const row = rows.get(selectedId);
		if (row === undefined || isArchivedWorkspace(row.workspace)) return false;
		void actions.workspaces.archive(selectedId, { deleteBranch: false }).then((result) => {
			if (!result.ok) toastError("Couldn't archive the workspace", result.error);
		});
		return true;
	});
	useCommandHandler("workspace.copyLink", "base", () => {
		if (selectedId === null) return false;
		void actions.app.copyText(buildDeepLink(selectedId, null)).then((result) => {
			if (!result.ok) toastError("Couldn't copy the link", result.error);
		});
		return true;
	});

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

	/**
	 * Moves the dragged project to the target's slot, the way Conductor reorders its project groups
	 * (renderApp @10510000): the dragged id leaves the visible order and is inserted where the
	 * target sits, so dropping onto the row below swaps the two.
	 */
	const reorderProjects = (draggedId: string, targetId: string) => {
		const ids = repos.map((repo) => repo.id);
		const from = ids.indexOf(draggedId as RepoId);
		const to = ids.indexOf(targetId as RepoId);
		if (from === -1 || to === -1 || from === to) return;
		const [moved] = ids.splice(from, 1);
		if (moved === undefined) return;
		ids.splice(to, 0, moved);
		void actions.projects.reorder(ids).then((result) => {
			if (!result.ok) toastError("Couldn't reorder the projects", result.error);
		});
	};

	const clearFilter = () => changeView({ ...view, projectFilter: [] });

	const toggleMyWorkspaces = () => {
		void actions.settings
			.set("sidebar_my_workspaces_collapsed", !myWorkspacesCollapsed)
			.then((result) => {
				if (!result.ok) toastError("Couldn't save the sidebar view", result.error);
			});
	};

	return (
		<WorkspaceDragProvider>
			<ContextMenu
				items={
					<ContextMenuItem onSelect={() => setNewSectionOpen(true)}>New section...</ContextMenuItem>
				}
			>
				<div className="flex flex-col" data-sidebar-list="">
					{/* Conductor's list header (Rtr, renderApp @10493990): "My workspaces" in 12px semibold
				    muted text, its actions behind an ellipsis that shows on hover (D098). The header
				    folds the main list and remembers the fold. */}
					<div className="group/header relative mt-0.5 px-2">
						<button
							type="button"
							aria-expanded={!myWorkspacesCollapsed}
							onClick={toggleMyWorkspaces}
							className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left group-hover/header:bg-hover"
						>
							<span className="min-w-0 flex-1 truncate text-xs font-semibold text-sidebar-fg-muted">
								My workspaces
							</span>
							<span aria-hidden="true" className="w-6 shrink-0" />
							<HeaderChevron open={!myWorkspacesCollapsed} focusWithin />
						</button>
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
					<div hidden={myWorkspacesCollapsed}>
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
										open={!isCollapsed(group)}
										onOpenChange={(open) => setGroupOpen(key, open)}
										onReorder={saveOrder(key)}
										repoReorderable={projectGroupCount > 1}
										onReorderRepo={reorderProjects}
									/>
								);
							})
						)}
					</div>
					<SectionDialog open={newSectionOpen} onOpenChange={setNewSectionOpen} section={null} />
				</div>
			</ContextMenu>
		</WorkspaceDragProvider>
	);
}
