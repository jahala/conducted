/**
 * @feature NAV-04 Pinned section
 * Owns: The collapsible Pinned group at the top of the list, and its drop target.
 * Behaviour: ui-map.md 4 item 4 (Pinned: collapsible, count when collapsed, drop target 'Drag a
 * workspace here', aria 'Pinned workspaces').
 * Must handle: Empty and nothing is being dragged (hidden); empty and a drag is in progress (show
 * the drop hint); collapsed (show the count); a drop of an archived workspace is refused; the drop
 * calls workspaces.setPinned.
 * Our design choice: Pinned is not a stored section. It reads workspaces whose `pinnedAt` is set,
 * and the caller passes them in. The collapsed state is local to the list; the order inside
 * Pinned belongs to the caller.
 * Test first: Dropping a workspace on the section calls setPinned(id, true).
 */
import type { WorkspaceId } from "@conducted/shared";
import { useParams } from "@tanstack/react-router";
import { type DragEvent, useState } from "react";
import { useActions, useRepos } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/Collapsible.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, ChevronRightIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { useNow } from "./use-now.ts";
import { useWorkspaceDrag, WORKSPACE_DRAG_MIME } from "./use-workspace-drag.ts";
import { WorkspaceRow } from "./WorkspaceRow.tsx";

export interface PinnedSectionProps {
	workspaces: Workspace[];
	/** True while a workspace is dragged from another list, so an empty Pinned shows its hint. */
	dragging?: boolean;
}

export function PinnedSection({ workspaces, dragging = false }: PinnedSectionProps) {
	const actions = useActions();
	const repos = useRepos();
	const params = useParams({ strict: false });
	const selectedId = (params as { workspaceId?: WorkspaceId }).workspaceId ?? null;
	const now = useNow();
	const [open, setOpen] = useState(true);
	const drag = useWorkspaceDrag({
		pin: (id) => actions.workspaces.setPinned(id, true),
		onError: toastError,
	});

	const isDragging = dragging || drag.state.draggingId !== null;
	if (workspaces.length === 0 && !isDragging) return null;

	const repoById = new Map(
		repos.state === "ready" ? repos.data.map((repo) => [repo.id, repo]) : [],
	);

	const drop = (event: DragEvent) => {
		event.preventDefault();
		const carried =
			event.dataTransfer?.getData(WORKSPACE_DRAG_MIME) ||
			event.dataTransfer?.getData("text/plain") ||
			drag.state.draggingId ||
			undefined;
		drag.dragOver(null);
		if (carried === undefined || carried === "") {
			drag.cancel();
			return;
		}
		const workspace = workspaces.find((candidate) => candidate.id === carried);
		// An archived workspace is not a sidebar row, so it cannot be pinned by a drop.
		if (workspace === undefined || workspace.state === "archived") {
			drag.cancel();
			return;
		}
		drag.dropOn("pinned", 0, carried as WorkspaceId);
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
