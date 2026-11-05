/**
 * @feature NAV-04 Pinned section
 * Owns: The collapsible Pinned group at the top of the list, and its drop target.
 * Behaviour: ui-map.md 4 item 4 (Pinned: collapsible, count when collapsed, drop target 'Drag a
 * workspace here', aria 'Pinned workspaces').
 * Must handle: Empty and nothing is being dragged (hidden); empty and a drag is in progress (show
 * the drop hint); collapsed (show the count); a drop of an archived workspace is refused; the drop
 * calls workspaces.setPinned; with manual order on a pinned row reorders the pin order.
 * Our design choice: Pinned is not a stored section. It reads workspaces whose `pinnedAt` is set,
 * and the caller passes them in together with the full list the drop looks a workspace up in. The
 * collapsed state is local to the list; the caller saves the order inside Pinned.
 * Test first: Dropping a workspace on the section calls setPinned(id, true).
 */
import type { Result, WorkspaceId } from "@conducted/shared";
import { useParams } from "@tanstack/react-router";
import { type DragEvent, useState } from "react";
import { useActions, useRepos, useSetting } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/Collapsible.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, ChevronRightIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { useNow } from "./use-now.ts";
import { draggedWorkspace, useWorkspaceDrag, WORKSPACE_DRAG_MIME } from "./use-workspace-drag.ts";
import { WorkspaceRow } from "./WorkspaceRow.tsx";

export interface PinnedSectionProps {
	/** The pinned workspaces, in the order the list should show them. */
	workspaces: Workspace[];
	/** Every visible workspace, so a drop from the main list finds the one it carries. */
	allWorkspaces: readonly Workspace[];
	/** True while a workspace is dragged from another list, so an empty Pinned shows its hint. */
	dragging?: boolean;
	/** Saves a new order inside Pinned when manual order is on. */
	onReorder?: (orderedIds: readonly WorkspaceId[]) => Promise<Result<unknown>> | undefined;
}

export function PinnedSection({
	workspaces,
	allWorkspaces,
	dragging = false,
	onReorder,
}: PinnedSectionProps) {
	const actions = useActions();
	const repos = useRepos();
	const params = useParams({ strict: false });
	const selectedId = (params as { workspaceId?: WorkspaceId }).workspaceId ?? null;
	const now = useNow();
	const manualOrder = useSetting<boolean>("manual_workspace_order");
	const [open, setOpen] = useState(true);
	const order = workspaces.map((workspace) => workspace.id);
	const drag = useWorkspaceDrag({
		order,
		manualOrder,
		reorder: onReorder,
		pin: (id) => actions.workspaces.setPinned(id, true),
		onError: toastError,
	});

	const isDragging = dragging || drag.state.draggingId !== null;
	if (workspaces.length === 0 && !isDragging) return null;

	const repoById = new Map(
		repos.state === "ready" ? repos.data.map((repo) => [repo.id, repo]) : [],
	);

	const carried = (event: DragEvent): WorkspaceId | null =>
		draggedWorkspace(event, drag.state.draggingId);

	const drop = (event: DragEvent) => {
		event.preventDefault();
		const carriedId = carried(event);
		drag.dragOver(null);
		if (carriedId === null) {
			drag.cancel();
			return;
		}
		// Look the workspace up in the full list: the pinned list does not hold one dragged from
		// the main list.
		const workspace = allWorkspaces.find((candidate) => candidate.id === carriedId);
		// An archived workspace is not a sidebar row, so it cannot be pinned by a drop.
		if (workspace === undefined || workspace.state === "archived") {
			drag.cancel();
			return;
		}
		drag.dropOn("pinned", 0, carriedId);
	};

	return (
		<section
			aria-label="Pinned workspaces"
			data-workspace-pinned-drop=""
			className={cn(
				"mb-1 rounded-md",
				isDragging && drag.state.overTarget === "pinned" && "bg-hover",
			)}
			onDragOver={(event) => {
				event.preventDefault();
				drag.dragOver("pinned");
			}}
			onDragLeave={() => drag.dragOver(null)}
			onDrop={drop}
		>
			<Collapsible open={open} onOpenChange={setOpen}>
				<div className="flex items-center gap-1 px-2">
					<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-sidebar-fg-muted hover:bg-hover hover:text-fg">
						{open ? <ChevronDownIcon /> : <ChevronRightIcon />}
						<span className="truncate">Pinned</span>
						{open ? null : (
							<span className="ml-1 text-2xs text-fg-subtle">{workspaces.length}</span>
						)}
					</CollapsibleTrigger>
				</div>
				<CollapsibleContent>
					{workspaces.length === 0 ? (
						<p className="px-3 py-2 text-xs text-fg-subtle">Drag a workspace here</p>
					) : (
						<div className="flex flex-col gap-0.5 py-0.5">
							{workspaces.map((workspace) => {
								const repo = repoById.get(workspace.repoId);
								return (
									// biome-ignore lint/a11y/noStaticElementInteractions: a sidebar row is a drag source; its link is the interactive part.
									<div
										key={workspace.id}
										draggable
										data-workspace-id={workspace.id}
										onDragStart={(event) => {
											event.dataTransfer?.setData(WORKSPACE_DRAG_MIME, workspace.id);
											event.dataTransfer?.setData("text/plain", workspace.id);
											drag.startDrag(workspace.id);
										}}
										onDragEnd={drag.cancel}
										onDragOver={(event) => {
											event.preventDefault();
											event.stopPropagation();
											drag.dragOver(`row:${workspace.id}`);
										}}
										onDrop={(event) => {
											event.preventDefault();
											event.stopPropagation();
											const carriedId = carried(event);
											if (carriedId === null) return;
											if (manualOrder && order.includes(carriedId)) {
												drag.dropOn(`row:${workspace.id}`, 1, carriedId);
												return;
											}
											drop(event);
										}}
									>
										{repo === undefined ? (
											<p className="truncate px-2 py-1.5 text-sm text-fg-muted">
												{workspace.displayName ?? workspace.branch}
											</p>
										) : (
											<WorkspaceRow
												workspace={workspace}
												repo={repo}
												selected={selectedId === workspace.id}
												shortcutIndex={null}
												now={now}
											/>
										)}
									</div>
								);
							})}
						</div>
					)}
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
}
