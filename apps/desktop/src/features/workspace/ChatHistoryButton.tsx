/**
 * @feature CHAT-01 Chat history button
 * Owns: The clock button at the end of the tab strip and its popover, which lists the workspace's
 * closed chats so one can be reopened.
 * Behaviour: ui-map.md 3.2 ('View chat history'). Conductor's renderApp draws the button only when
 * the workspace has closed chats, and its popover lists just those: title, then how long ago the chat
 * changed. The open chats are the tab strip's, and "+" starts a new chat.
 * Data: useClosedSessions(workspaceId).
 * Our design choice (D098, ours placed in Conductor's layout): a search field over the list, for a
 * workspace with many closed chats. Conductor's rows also carry the agent's logo; we ship no agent
 * logos, so the row starts with the title.
 * Must handle: loading or no closed chat (no button); a load error (the button stays away, as there
 * is nothing to list); a closed chat reopens in a new tab and keeps its history; a long list scrolls
 * and can be searched by title.
 * Test first: Choosing a closed chat calls sessions.reopen(id) and opens its tab.
 */

import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useActions, useClosedSessions } from "../../core/hooks.ts";
import type { Session } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { ClockIcon, SearchIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { relativeTime } from "../sidebar/WorkspaceRow.tsx";
import { REOPEN_CHAT_FAILED } from "./chat-tab-messages.ts";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface ChatHistoryButtonProps {
	workspaceId: WorkspaceId;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

const titleOf = (session: Session): string => session.title ?? "New chat";

const lastClosedFirst = (a: Session, b: Session): number => (b.closedAt ?? 0) - (a.closedAt ?? 0);

/** Conductor's wording for a past moment: "just now", then "5m ago", "3h ago", "2d ago". */
function timeAgo(at: number, now: number): string {
	const short = relativeTime(at, now);
	return short === "now" ? "just now" : `${short} ago`;
}

export function ChatHistoryButton({ workspaceId, onSearchChange }: ChatHistoryButtonProps) {
	const closed = useClosedSessions(workspaceId);
	const actions = useActions();
	const [menuOpen, setMenuOpen] = useState(false);
	const [query, setQuery] = useState("");

	if (closed.state !== "ready" || closed.data.length === 0) return null;
	const now = Date.now();
	const needle = query.trim().toLowerCase();
	const sessions = [...closed.data]
		.sort(lastClosedFirst)
		.filter((session) => needle.length === 0 || titleOf(session).toLowerCase().includes(needle));

	const reopen = async (session: Session) => {
		const reopened = await actions.sessions.reopen(session.id);
		if (!reopened.ok) {
			toastError(REOPEN_CHAT_FAILED, reopened.error);
			return;
		}
		setMenuOpen(false);
		onSearchChange({ tab: "session", sessionId: session.id });
	};

	return (
		<Menu open={menuOpen} onOpenChange={setMenuOpen}>
			<MenuTrigger asChild>
				<Button variant="ghost" size="sm" className="w-7 px-0" aria-label="View chat history">
					<ClockIcon />
				</Button>
			</MenuTrigger>
			<MenuContent className="max-h-80 w-72 overflow-y-auto p-1" aria-label="Chat history">
				<div className="p-1">
					<label className="sr-only" htmlFor={`chat-history-search-${workspaceId}`}>
						Search chats
					</label>
					<div className="flex h-8 items-center gap-2 rounded-md border border-border-strong px-2">
						<SearchIcon className="text-fg-muted" />
						<input
							id={`chat-history-search-${workspaceId}`}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => event.stopPropagation()}
							placeholder="Search chats"
							className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
						/>
					</div>
				</div>
				{sessions.map((session) => (
					<MenuItem key={session.id} onSelect={() => void reopen(session)} className="gap-2">
						<span className="min-w-0 flex-1 truncate text-xs font-medium">{titleOf(session)}</span>
						<span className="shrink-0 text-xs text-fg-muted">
							{timeAgo(session.updatedAt, now)}
						</span>
					</MenuItem>
				))}
				{sessions.length === 0 ? (
					<p className="px-2 py-3 text-sm text-fg-muted">No matching chats</p>
				) : null}
			</MenuContent>
		</Menu>
	);
}
