/**
 * @feature NAV-06 Kanban card
 * Owns: One draggable card: workspace name, repository, derived status text and line changes,
 * plus the status menu (the status mark as a button) that keyboard users change a card's status
 * with, as on Conductor's card.
 * Behaviour: ui-map.md 2 (Dashboard cards), 3.8 (derived status is separate from the Kanban status).
 * Our design choice: the card is a link that opens the workspace, with the status menu beside the
 * link rather than nested inside it. The status button's accessible name ("Status: Backlog") is
 * ours; Conductor's button shows only the mark. The drag payload names the workspace id, so a column does not
 * need to hold the dragged card itself.
 * Must handle: Dragging starts after the card moves (the browser's own drag threshold) so a click
 * still opens the workspace; the card is also a link; a card being dragged is dimmed in place;
 * focus ring; a status that has not loaded yet adds no status line; line changes wait for the git
 * state and add nothing until it loads.
 * Test first: Clicking the card without moving opens the workspace; moving it starts a drag.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useGitState, useWorkspaceStatus } from "../../core/hooks.ts";
import type { KanbanStatus, Repo, Workspace } from "../../core/model.ts";
import { cn } from "../../ui/cn.ts";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../../ui/Menu.tsx";
import { STATUS_TONE_CLASS, statusText } from "../workspace/status-text.ts";
import { useBranchPrefix } from "../workspace/use-branch-prefix.ts";
import { workspaceName } from "../workspace/workspace-name.ts";
import { KANBAN_COLUMNS, KANBAN_DRAG_TYPE, KANBAN_STATUS_MARK, KANBAN_STATUSES } from "./kanban.ts";

export interface KanbanCardProps {
	workspace: Workspace;
	repo: Repo;
	/** Move a card to another column. The screen persists it and rolls back on failure. */
	onMove: (workspaceId: Workspace["id"], status: KanbanStatus) => void;
}

export function KanbanCard({ workspace, repo, onMove }: KanbanCardProps) {
	const status = useWorkspaceStatus(workspace.id);
	const git = useGitState(workspace.id);
	const [dragging, setDragging] = useState(false);
	const name = workspaceName(workspace, useBranchPrefix());
	const subtitle = statusText(status);
	const lines = git.state === "ready" ? git.data : null;

	return (
		<article
			data-testid="kanban-card"
			data-workspace-id={workspace.id}
			draggable
			onDragStart={(event) => {
				setDragging(true);
				event.dataTransfer?.setData(KANBAN_DRAG_TYPE, workspace.id);
				if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
			}}
			onDragEnd={() => setDragging(false)}
			className={cn(
				"flex items-start gap-2 rounded-lg border border-border bg-raised p-3 transition-opacity",
				dragging && "opacity-50",
			)}
		>
			<Link
				to="/repository/$repositoryId/workspace/$workspaceId"
				params={{ repositoryId: repo.id, workspaceId: workspace.id }}
				className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-focus"
			>
				<span className="truncate text-sm font-medium text-fg">{name}</span>
				<span className="truncate text-xs text-fg-subtle">{repo.name}</span>
				{subtitle.text === "" ? null : (
					<span className={cn("truncate text-xs", STATUS_TONE_CLASS[subtitle.tone])}>
						{subtitle.text}
					</span>
				)}
				{lines !== null && (lines.linesAdded > 0 || lines.linesRemoved > 0) ? (
					<span className="flex items-center gap-2 text-2xs">
						{lines.linesAdded > 0 ? (
							<span className="text-git-added">+{lines.linesAdded}</span>
						) : null}
						{lines.linesRemoved > 0 ? (
							<span className="text-git-removed">-{lines.linesRemoved}</span>
						) : null}
					</span>
				) : null}
			</Link>
			<Menu>
				<MenuTrigger asChild>
					<button
						type="button"
						aria-label={`Status: ${KANBAN_COLUMNS[workspace.kanbanStatus].label}`}
						className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
					>
						<span
							aria-hidden="true"
							className={cn("size-2 rounded-full", KANBAN_STATUS_MARK[workspace.kanbanStatus])}
						/>
					</button>
				</MenuTrigger>
				<MenuContent align="start" aria-label={`Status of ${name}`}>
					<MenuRadioGroup value={workspace.kanbanStatus}>
						{KANBAN_STATUSES.map((option) => (
							<MenuRadioItem
								key={option}
								value={option}
								onSelect={() => onMove(workspace.id, option)}
							>
								<span className="flex items-center gap-2">
									<span
										aria-hidden="true"
										className={cn("size-2 rounded-full", KANBAN_STATUS_MARK[option])}
									/>
									{KANBAN_COLUMNS[option].label}
								</span>
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</MenuContent>
			</Menu>
		</article>
	);
}
