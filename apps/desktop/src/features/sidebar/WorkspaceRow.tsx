/**
 * @feature NAV-03 Workspace row
 * @feature NAV-16 Draft markers on the Create row and on workspaces
 * Owns: One row of the sidebar list: project avatar (outside project groups), status icon, name,
 * unread dot, the "Open draft" marker, line change counts, and badges.
 * Behaviour: ui-map.md 4 (workspace row: name from the user-set name, PR title, branch or
 * directory; the repo avatar's emoji, uploaded icon, favicon, owner avatar or letter; badges Draft
 * and Archive workspace; Cmd+1..9 switch; hover keys R read and P pin), 3.8 (status text), 5.3
 * (right-clicking the repo icon offers Change repository icon).
 * Measured from Conductor 0.92.1 (renderApp @10437578): a 6px-radius row, 8px top and bottom, 6px
 * right, one 20px line, so 36px tall; its left padding set by where it sits (20px in the status and
 * project groups, 12px in Pinned, 6px in the user's sections, @10474003);
 * hover and selected use the 5% tint; the leading visuals are 16px boxes 6px apart (the project avatar,
 * then the status icon); the name is a 20px line in weight 450 and the muted sidebar colour, selected or
 * not (the selected row shows only through its fill, renderApp @10427352), 600 and the stronger colour
 * when unread; at the right the added and removed line counts in
 * small monospace ("+4.1k -3"), compact past a thousand. The draft marker sits just before the counts,
 * as in Conductor's trailing cluster (renderApp @10431468). A row with no line counts shows nothing
 * there: Conductor's row has no time (D098).
 * Conductor's row has no second line: its status words ("Working...", "Need permission") live in the
 * hover card and the row shows the status only through its icon (@10442724, @10452011). Ours names
 * the status on the icon (its tooltip and accessible name), since the hover card is not built.
 * Our design choice: The row is a link to the workspace route. Status words come from
 * status-text.ts. Right-clicking the row opens NAV-10's Workspace actions menu, as in Conductor.
 * The Draft badge needs the pull request state and is left out until its owner is built. The "Archive workspace" badge
 * waits for the state that WS-09 gives it; archived workspaces are never listed here. Hovering a
 * row and pressing the live `sidebar.toggleRead` binding toggles its read state, even when nothing
 * is focused; P waits for NAV-04.
 * Must handle: A long name truncates; selected row is marked by background, not accent; unread dot
 * only when there are unread chats; no status yet (hook returns null); hover shows the live
 * Cmd+number hint for this row; keyboard focus ring; a chat whose draft is still loading (the
 * marker appears when it arrives); the marker opening the draft chat without leaving the row.
 * Test first: A workspace with a PR title and no display name shows the PR title; an unread count
 * above zero shows the unread dot.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { scopesForTarget } from "../../app/command-dispatcher.ts";
import {
	useActions,
	useGitState,
	useLiveShortcut,
	useSessions,
	useWorkspaceStatus,
} from "../../core/hooks.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { formatShortcut } from "../../core/registries/commands.ts";
import { cn } from "../../ui/cn.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { useWorkspaceDraft } from "../composer/draft-sources.ts";
import { statusText } from "../workspace/status-text.ts";
import { WorkspaceActionsMenu } from "../workspace/WorkspaceActionsMenu.tsx";
import { WorkspaceStatusIcon } from "../workspace/WorkspaceStatusIcon.tsx";
import { workspaceName } from "../workspace/workspace-name.ts";
import { DraftMarker } from "./DraftMarker.tsx";
import { RepoIconAvatar } from "./RepoIcon.tsx";
import { UnreadDot } from "./UnreadDot.tsx";

export interface WorkspaceRowProps {
	workspace: Workspace;
	repo: Repo;
	selected: boolean;
	/** 1 to 9 for the first nine rows, which have a Cmd+number shortcut. */
	shortcutIndex: number | null;
	/** The project's avatar leads the row; off inside a project's own group, whose header shows it. */
	showRepo?: boolean;
	/** Left padding by where the row sits: 20px in the main groups, 12px in Pinned, 6px in sections. */
	indent?: RowIndent;
}

export type RowIndent = "grouped" | "pinned" | "flush";

const INDENT_CLASS: Readonly<Record<RowIndent, string>> = {
	grouped: "pl-5",
	pinned: "pl-3",
	flush: "pl-1.5",
};

/** Line counts as Conductor writes them in a row: 552, 4.1k, 16k. */
export function compactCount(value: number): string {
	if (value < 1000) return String(value);
	if (value < 10_000) {
		const tenths = Math.floor(value / 100) / 10;
		return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)}k`;
	}
	return `${Math.round(value / 1000)}k`;
}

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

/** A short, stable relative time such as "5m" or "3d", for Home's Last active column. */
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

export function WorkspaceRow({
	workspace,
	repo,
	selected,
	shortcutIndex,
	showRepo = true,
	indent = "grouped",
}: WorkspaceRowProps) {
	const actions = useActions();
	const navigate = useNavigate();
	const status = useWorkspaceStatus(workspace.id);
	// Read only: the row shows the counts once the git state is known and never starts a git read.
	const git = useGitState(workspace.id);
	const counts =
		git.state === "ready" && (git.data.linesAdded > 0 || git.data.linesRemoved > 0)
			? { added: git.data.linesAdded, removed: git.data.linesRemoved }
			: null;
	const sessions = useSessions(workspace.id);
	const draft = useWorkspaceDraft(
		sessions.state === "ready" ? sessions.data.map((session) => session.id) : [],
	);
	const unread =
		sessions.state === "ready" && sessions.data.some((session) => session.unreadCount > 0);
	const statusWords = statusText(status).text;
	const liveShortcut = useLiveShortcut(
		shortcutIndex === null ? "workspace.switch1" : `workspace.switch${shortcutIndex}`,
	);
	const [hovered, setHovered] = useState(false);
	const readShortcut = useLiveShortcut("sidebar.toggleRead");

	const openDraft = () => {
		if (draft === null) return;
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: repo.id, workspaceId: workspace.id },
			search: { tab: "session", sessionId: draft.sessionId },
		});
	};

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
		<WorkspaceActionsMenu workspaceId={workspace.id}>
			<Link
				to="/repository/$repositoryId/workspace/$workspaceId"
				params={{ repositoryId: repo.id, workspaceId: workspace.id }}
				aria-current={selected ? "page" : undefined}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				className={cn(
					"group relative flex min-w-0 items-start gap-1.5 rounded-md py-2 pr-1.5 text-sm text-sidebar-fg transition-colors hover:bg-hover",
					INDENT_CLASS[indent],
					selected && "bg-hover",
				)}
			>
				{showRepo ? (
					<span className="mt-0.5 mr-0.5 flex size-4 shrink-0 items-center justify-center">
						<RepoIconAvatar repo={repo} className="text-sidebar-fg-muted" />
					</span>
				) : null}
				<span
					{...(statusWords === ""
						? {}
						: { role: "img", "aria-label": statusWords, title: statusWords })}
					className="mt-0.5 flex size-4 shrink-0 items-center justify-center overflow-hidden"
				>
					<WorkspaceStatusIcon status={status} decorative />
				</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex h-5 min-w-0 items-center gap-1.5">
						<span
							className={cn(
								"min-w-0 truncate",
								unread ? "font-semibold text-fg" : "font-book text-sidebar-fg-muted",
							)}
						>
							{workspaceName(workspace)}
						</span>
						<span className="flex-1" />
						<UnreadDot unread={unread} />
						<DraftMarker
							place="workspace-row"
							draft={draft?.draft ?? null}
							onOpenDraft={openDraft}
						/>
						{counts !== null ? (
							<span className="flex shrink-0 items-center gap-1 px-1 py-0.5 font-mono text-2xs font-medium group-hover:hidden">
								<span className="text-git-added">+{compactCount(counts.added)}</span>
								{counts.removed > 0 ? (
									<span className="text-git-removed">-{compactCount(counts.removed)}</span>
								) : null}
							</span>
						) : null}
						{shortcutIndex === null || liveShortcut === null ? null : (
							<span
								aria-hidden="true"
								className="hidden shrink-0 group-hover:inline-flex group-focus-visible:inline-flex"
							>
								<Kbd>{liveShortcut}</Kbd>
							</span>
						)}
					</span>
				</span>
			</Link>
		</WorkspaceActionsMenu>
	);
}
