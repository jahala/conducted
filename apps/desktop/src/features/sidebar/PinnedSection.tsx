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
import { useRef, useState } from "react";
import { useActions, useRepos, useSetting } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/Collapsible.tsx";
import { cn } from "../../ui/cn.ts";
import { PinIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { HeaderChevron, HeaderCount } from "./section-header.tsx";
import { useWorkspaceDrag } from "./use-workspace-drag.ts";
import { WorkspaceRow } from "./WorkspaceRow.tsx";
import { useWorkspaceDragController, useWorkspaceHitTest } from "./workspace-drag-context.tsx";

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

/** True when a point lies inside a rectangle. jsdom gives every element a zero rectangle. */
function containsPoint(rect: DOMRect, point: { x: number; y: number }): boolean {
	return (
		point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
	);
}

export function PinnedSection({
	workspaces,
	allWorkspaces,
	dragging = false,
	onReorder,
}: PinnedSectionProps) {
	const pointer = useWorkspaceDragController();
	const sectionRef = useRef<HTMLElement | null>(null);
	const actions = useActions();
	const repos = useRepos();
	const params = useParams({ strict: false });
	const selectedId = (params as { workspaceId?: WorkspaceId }).workspaceId ?? null;
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

	// A drag that starts in the main list or a section also shows an empty Pinned as a drop target.
	const isDragging = dragging || pointer.drag !== null;

	const repoById = new Map(
		repos.state === "ready" ? repos.data.map((repo) => [repo.id, repo]) : [],
	);

	// Look the workspace up in the full list: the pinned list does not hold one dragged from the
	// main list. An archived workspace is not a sidebar row, so it cannot be pinned by a drop.
	const pinWorkspace = (workspaceId: WorkspaceId) => {
		const workspace = allWorkspaces.find((candidate) => candidate.id === workspaceId);
		if (workspace === undefined || isArchivedWorkspace(workspace)) {
			drag.cancel();
			return;
		}
		drag.dropOn("pinned", 0, workspaceId);
	};

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
					if (manualOrder && order.includes(payload.id)) {
						const after = rect.height > 0 && at.y > rect.top + rect.height / 2;
						drag.dropOn(`row:${workspaceId}`, after ? 1 : 0, payload.id);
						return;
					}
					pinWorkspace(payload.id);
				},
			};
		}
		const rect = root.getBoundingClientRect();
		if (!containsPoint(rect, point)) return undefined;
		return {
			key: "pinned",
			element: root,
			drop: (payload) => {
				if (payload.kind === "workspace") pinWorkspace(payload.id);
			},
		};
	});

	if (workspaces.length === 0 && !isDragging) return null;

	return (
		<section
			ref={sectionRef}
			aria-label="Pinned workspaces"
			data-workspace-pinned-drop=""
			className={cn(
				"rounded-md px-1.5 pt-1.5 pb-3",
				isDragging && pointer.drag?.target?.key === "pinned" && "bg-hover",
			)}
		>
			<Collapsible open={open} onOpenChange={setOpen}>
				<div className="group/header mt-0.5 mb-1 flex items-center gap-0.5">
					<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left text-xs font-semibold text-sidebar-fg-muted hover:bg-hover">
						<span className="min-w-0 truncate">Pinned</span>
						<HeaderCount open={open} count={workspaces.length} />
						<HeaderChevron open={open} />
					</CollapsibleTrigger>
				</div>
				<CollapsibleContent>
					{workspaces.length === 0 ? (
						<p className="flex h-9 items-center gap-2 pl-3 text-sm text-sidebar-fg-muted">
							<PinIcon className="size-3.5 shrink-0" />
							<span className="min-w-0 truncate">Drag a workspace here</span>
						</p>
					) : (
						<div className="flex flex-col gap-1">
							{workspaces.map((workspace) => {
								const repo = repoById.get(workspace.repoId);
								return (
									<div
										key={workspace.id}
										data-workspace-id={workspace.id}
										className="touch-none"
										onClickCapture={pointer.consumeClick}
										onPointerDown={(event) => {
											drag.startDrag(workspace.id);
											pointer.start(event, { kind: "workspace", id: workspace.id });
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
												indent="pinned"
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
