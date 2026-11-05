/**
 * @feature NAV-03 Workspace row
 * Owns: One row of the sidebar list: status icon, name, repo avatar, line change counts, unread
 * dot, relative time, status text and badges.
 * Behaviour: ui-map.md 4 (workspace row: name from the user-set name, PR title, branch or
 * directory; badges Draft and Archive workspace; Cmd+1..9 switch; hover keys R read and P pin), 3.8
 * (status text).
 * Our design choice: The row is a link to the workspace route. Status words come from
 * status-text.ts. Line counts need GIT-04, the Draft badge needs the pull request state and the
 * actions menu is NAV-10; each is left out until its owner is built. The "Archive workspace" badge
 * is not needed in this list because archived workspaces are never listed.
 * Must handle: A long name truncates; selected row is marked by background, not accent; unread dot
 * only when there are unread chats; no status yet (hook returns null); hover shows the Cmd+number
 * hint; keyboard focus ring.
 * Test first: A workspace with a PR title and no display name shows the PR title; an unread count
 * above zero shows the unread dot.
 */
import { Link } from "@tanstack/react-router";
import { useSessions, useWorkspaceStatus } from "../../core/hooks.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { cn } from "../../ui/cn.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { type StatusTone, statusText } from "../workspace/status-text.ts";
import { WorkspaceStatusIcon } from "../workspace/WorkspaceStatusIcon.tsx";
import { UnreadDot } from "./UnreadDot.tsx";

export interface WorkspaceRowProps {
	workspace: Workspace;
	repo: Repo;
	selected: boolean;
	/** 1 to 9 for the first nine rows, which have a Cmd+number shortcut. */
	shortcutIndex: number | null;
}

const toneClass: Record<StatusTone, string> = {
	attention: "text-accent",
	active: "text-fg-muted",
	danger: "text-danger",
	success: "text-success",
	neutral: "text-fg-muted",
};

/** A short, stable relative time such as "5m" or "3d". */
export function relativeTime(at: number, now: number): string {
	const seconds = Math.max(0, Math.floor((now - at) / 1000));
	if (seconds < 60) return "now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo`;
	return `${Math.floor(months / 12)}y`;
}

/** The name Conductor shows: user-set name, then PR title, branch, and finally the folder name. */
export function workspaceName(
	workspace: Pick<Workspace, "displayName" | "prTitle" | "branch" | "directoryName">,
): string {
	return (
		workspace.displayName?.trim() ||
		workspace.prTitle?.trim() ||
		workspace.branch?.trim() ||
		workspace.directoryName
	);
}

function RepoAvatar({ repo }: { repo: Repo }) {
	const icon = repo.icon?.trim();
	const text =
		icon !== undefined && icon !== "" ? icon : repo.name.slice(0, 1).toUpperCase() || "?";
	return (
		<span
			aria-hidden="true"
			className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-hover text-3xs font-medium text-fg-muted"
		>
			{text}
		</span>
	);
}

export function WorkspaceRow({ workspace, repo, selected, shortcutIndex }: WorkspaceRowProps) {
	const status = useWorkspaceStatus(workspace.id);
	const sessions = useSessions(workspace.id);
	const unread =
		sessions.state === "ready" && sessions.data.some((session) => session.unreadCount > 0);
	const subtitle = statusText(status);
	const now = Date.now();

	return (
		<Link
			to="/repository/$repositoryId/workspace/$workspaceId"
			params={{ repositoryId: repo.id, workspaceId: workspace.id }}
			aria-current={selected ? "page" : undefined}
			className={cn(
				"group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
				selected ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
			)}
		>
			<span className="flex size-4 shrink-0 items-center justify-center">
				<WorkspaceStatusIcon status={status} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-book">{workspaceName(workspace)}</span>
				{subtitle.text === "" ? null : (
					<span className={cn("truncate text-xs", toneClass[subtitle.tone])}>{subtitle.text}</span>
				)}
			</span>
			<RepoAvatar repo={repo} />
			<UnreadDot unread={unread} />
			<time
				dateTime={new Date(workspace.lastActivityAt).toISOString()}
				title={new Date(workspace.lastActivityAt).toLocaleString()}
				className="shrink-0 text-2xs text-fg-subtle"
			>
				{relativeTime(workspace.lastActivityAt, now)}
			</time>
			{shortcutIndex === null ? null : (
				<span className="hidden shrink-0 group-hover:inline-flex group-focus-visible:inline-flex">
					<Kbd>{`⌘${shortcutIndex}`}</Kbd>
				</span>
			)}
		</Link>
	);
}
