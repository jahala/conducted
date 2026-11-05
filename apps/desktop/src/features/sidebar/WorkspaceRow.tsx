/**
 * @feature NAV-03 Workspace row
 * Owns: One row of the sidebar list: status icon, name, repo avatar, line change counts, unread
 * dot, relative time, status text and badges.
 * Behaviour: ui-map.md 4 (workspace row: name from the user-set name, PR title, branch or
 * directory; badges Draft and Archive workspace; Cmd+1..9 switch; hover keys R read and P pin), 3.8
 * (status text).
 * Our design choice: The row is a link to the workspace route. The current time is a prop, so the
 * list can refresh every row's "5m" with one timer. Status words come from
 * status-text.ts. Line counts need GIT-04, the Draft badge needs the pull request state, and the
 * actions menu is NAV-10; each is left out until its owner is built. The "Archive workspace" badge
 * waits for the state that WS-09 gives it; archived workspaces are never listed here. Hovering a
 * row and pressing the live `sidebar.toggleRead` binding toggles its read state, even when nothing
 * is focused; P waits for NAV-04.
 * Must handle: A long name truncates; selected row is marked by background, not accent; unread dot
 * only when there are unread chats; no status yet (hook returns null); hover shows the live
 * Cmd+number hint for this row; keyboard focus ring.
 * Test first: A workspace with a PR title and no display name shows the PR title; an unread count
 * above zero shows the unread dot.
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { scopesForTarget } from "../../app/command-dispatcher.ts";
import { useActions, useLiveShortcut, useSessions, useWorkspaceStatus } from "../../core/hooks.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { formatShortcut } from "../../core/registries/commands.ts";
import { cn } from "../../ui/cn.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { type StatusTone, statusText } from "../workspace/status-text.ts";
import { WorkspaceStatusIcon } from "../workspace/WorkspaceStatusIcon.tsx";
import { workspaceName } from "../workspace/workspace-name.ts";
import { UnreadDot } from "./UnreadDot.tsx";

export interface WorkspaceRowProps {
	workspace: Workspace;
	repo: Repo;
	selected: boolean;
	/** 1 to 9 for the first nine rows, which have a Cmd+number shortcut. */
	shortcutIndex: number | null;
	/** The current time. The list reads it once a minute and hands it to every row. */
	now: number;
}

const toneClass: Record<StatusTone, string> = {
	attention: "text-accent",
	active: "text-fg-muted",
	danger: "text-danger",
	success: "text-success",
	neutral: "text-fg-muted",
};

/** The display form of the shortcut an event presses, as `useLiveShortcut` shows it. */
function shortcutFromEvent(event: KeyboardEvent): string | null {
	if (event.isComposing || event.repeat) return null;
	const parts: string[] = [];
	if (event.ctrlKey) parts.push("Ctrl");
	if (event.altKey) parts.push("Alt");
	if (event.metaKey) parts.push("Cmd");
	if (event.shiftKey) parts.push("Shift");
	const key = event.key === " " ? "Space" : event.key === "+" ? "Plus" : event.key;
	parts.push(key.length === 1 ? key.toUpperCase() : key);
	return formatShortcut(parts.join("+"));
}

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

export function WorkspaceRow({ workspace, repo, selected, shortcutIndex, now }: WorkspaceRowProps) {
	const actions = useActions();
	const status = useWorkspaceStatus(workspace.id);
	const sessions = useSessions(workspace.id);
	const unread =
		sessions.state === "ready" && sessions.data.some((session) => session.unreadCount > 0);
	const subtitle = statusText(status);
	const liveShortcut = useLiveShortcut(
		shortcutIndex === null ? "workspace.switch1" : `workspace.switch${shortcutIndex}`,
	);
	const [hovered, setHovered] = useState(false);
	const readShortcut = useLiveShortcut("sidebar.toggleRead");

	const toggleRead = () => {
		const failure = unread
			? "Couldn't mark the workspace as read"
			: "Couldn't mark the workspace as unread";
		void (
			unread
				? actions.workspaces.markRead(workspace.id)
				: actions.workspaces.markUnread(workspace.id)
		).then((result) => {
			if (!result.ok) toastError(failure, result.error);
		});
	};

	useEffect(() => {
		if (!hovered || readShortcut === null) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const scopes = scopesForTarget(event.target);
			// A dialog, menu, palette or text field owns its keys; only the hovered row remains.
			if (scopes.length !== 1 || scopes[0] !== "global") return;
			const pressed = shortcutFromEvent(event);
			if (pressed === null || pressed !== readShortcut) return;
			event.preventDefault();
			toggleRead();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	return (
		<Link
			to="/repository/$repositoryId/workspace/$workspaceId"
			params={{ repositoryId: repo.id, workspaceId: workspace.id }}
			aria-current={selected ? "page" : undefined}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className={cn(
				"group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
				selected ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
			)}
		>
			<span className="flex size-4 shrink-0 items-center justify-center">
				<WorkspaceStatusIcon status={status} decorative />
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
			{shortcutIndex === null || liveShortcut === null ? null : (
				<span className="hidden shrink-0 group-hover:inline-flex group-focus-visible:inline-flex">
					<Kbd>{liveShortcut}</Kbd>
				</span>
			)}
		</Link>
	);
}
