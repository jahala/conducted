/**
 * @feature NAV-06 Kanban card
 * Owns: One draggable card: workspace name, repository, derived status text and line changes,
 * plus the "Move" menu keyboard users change a card's status with.
 * Behaviour: ui-map.md 2 (Dashboard cards), 3.8 (derived status is separate from the Kanban status).
 * Our design choice: the card is a link that opens the workspace, with the status menu beside the
 * link rather than nested inside it. The drag payload names the workspace id, so a column does not
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
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import {
	KANBAN_STATUSES,
	KANBAN_COLUMNS,
	KANBAN_DRAG_TYPE,
} from "./kanban.ts";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuTrigger,
} from "../../ui/Menu.tsx";
import { statusText } from "../workspace/status-text.ts";
import { workspaceName } from "../workspace/workspace-name.ts";
import { type StatusTone } from "../workspace/status-text.ts";

export interface KanbanCardProps {
	workspace: Workspace;
	repo: Repo;
	/** Move a card to another column. The screen persists it and rolls back on failure. */
	onMove: (workspaceId: Workspace["id"], status: KanbanStatus) => void;
}

const toneClass: Record<StatusTone, string> = {
	attention: "text-accent",
	active: "text-fg-muted",
	danger: "text-danger",
	success: "text-success",
	neutral: "text-fg-muted",
};

export function KanbanCard({ workspace, repo, onMove }: KanbanCardProps) {
	const status = useWorkspaceStatus(workspace.id);
	const git = useGitState(workspace.id);
	const [dragging, setDragging] = useState(false);
	const name = workspaceName(workspace);
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
					<span className={cn("truncate text-xs", toneClass[subtitle.tone])}>
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
					<Button
						variant="ghost"
						size="xs"
						aria-label={`Move ${name}`}
						onClick={(event) => event.stopPropagation()}
					>
						Move
					</Button>
				</MenuTrigger>
				<MenuContent align="end" aria-label={`Move ${name}`}>
					<MenuLabel>Status</MenuLabel>
					{KANBAN_STATUSES.map((statusOption) => (
						<MenuItem
							key={statusOption}
							disabled={statusOption === workspace.kanbanStatus}
							onSelect={() => onMove(workspace.id, statusOption)}
						>
							{KANBAN_COLUMNS[statusOption].label}
						</MenuItem>
					))}
				</MenuContent>
			</Menu>
		</article>
	);
}
