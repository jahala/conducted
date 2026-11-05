/**
 * @feature CHAT-01 Chat history button
 * Owns: The button and popover that list all chats of the workspace, including closed ones, so one
 * can be reopened.
 * Behaviour: ui-map.md 3.2 ('View chat history' lists all chats, including closed ones; 'Loading
 * chats', 'No open chats' with 'New chat').
 * Data: useSessions(workspaceId) for the open chats and useClosedSessions(workspaceId) for the
 * closed ones. 'New chat' is useNewTab's, the same action as the '+' menu and Cmd+T.
 * Must handle: Loading; error; no chats at all ('New chat' starts one from the workspace's default
 * config); a closed chat reopens in a new tab and keeps its history; a very long list scrolls and
 * can be searched by title.
 * Test first: Choosing a closed chat calls sessions.reopen(id) and opens its tab.
 */

import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useActions, useClosedSessions, useSessions } from "../../core/hooks.ts";
import type { Session } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { ClockIcon, SearchIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { useNewTab } from "./useNewTab.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface ChatHistoryButtonProps {
	workspaceId: WorkspaceId;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

const titleOf = (session: Session): string => session.title ?? "New chat";

const newestFirst = (a: Session, b: Session): number => {
	const aAt = a.lastUserMessageAt ?? a.createdAt;
	const bAt = b.lastUserMessageAt ?? b.createdAt;
	return bAt - aAt;
};

export function ChatHistoryButton({ workspaceId, onSearchChange }: ChatHistoryButtonProps) {
	const open = useSessions(workspaceId);
	const closed = useClosedSessions(workspaceId);
	const actions = useActions();
	const newTab = useNewTab({ workspaceId, onSearchChange });
	const [menuOpen, setMenuOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);

	const openSessions = open.state === "ready" ? [...open.data].sort(newestFirst) : [];
	const closedSessions = closed.state === "ready" ? [...closed.data].sort(newestFirst) : [];

	const show = (session: Session) => {
		setMenuOpen(false);
		onSearchChange({ tab: "session", sessionId: session.id });
	};

	const choose = async (session: Session) => {
		if (session.closedAt === null) {
			show(session);
			return;
		}
		const reopened = await actions.sessions.reopen(session.id);
		if (!reopened.ok) {
			toastError("Couldn't reopen the chat", reopened.error);
			return;
		}
		show(session);
	};

	// useNewTab creates the chat, toasts a failure and opens the tab. It shares one single-flight
	// with the '+' menu and Cmd+T, so two requests at once start one chat.
	const newChat = async () => {
		setBusy(true);
		try {
			if (await newTab.newChat(false)) setMenuOpen(false);
		} finally {
			setBusy(false);
		}
	};

	const matches = (session: Session): boolean => {
		const needle = query.trim().toLowerCase();
		return needle.length === 0 || titleOf(session).toLowerCase().includes(needle);
	};
	const openMatches = openSessions.filter(matches);
	const closedMatches = closedSessions.filter(matches);
	const error =
		open.state === "error" ? open.error : closed.state === "error" ? closed.error : null;
	const loading = open.state === "loading" || closed.state === "loading";

	return (
		<Menu open={menuOpen} onOpenChange={setMenuOpen}>
			<MenuTrigger asChild>
				<Button variant="ghost" size="sm" className="w-7 px-0" aria-label="View chat history">
					<ClockIcon />
				</Button>
			</MenuTrigger>
			<MenuContent className="max-h-96 w-80 overflow-y-auto p-2" aria-label="Chat history">
				<div className="px-1 pb-2">
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
				{loading ? (
					<p role="status" className="px-2 py-3 text-sm text-fg-subtle">
						Loading chats
					</p>
				) : error !== null ? (
					<p role="alert" className="px-2 py-3 text-sm text-danger">
						Couldn't load chats. {error.message}
					</p>
				) : (
					<>
						{openSessions.length === 0 ? (
							<div className="flex items-center justify-between gap-2 px-2 py-2">
								<p className="text-sm text-fg-muted">No open chats</p>
								<Button size="xs" variant="secondary" loading={busy} onClick={() => void newChat()}>
									New chat
								</Button>
							</div>
						) : openMatches.length > 0 ? (
							<div>
								<p className="px-2 py-1 text-xs font-medium text-fg-subtle">Open chats</p>
								{openMatches.map((session) => (
									<MenuItem
										key={session.id}
										onSelect={() => void choose(session)}
										icon={<span className="size-1.5 rounded-full bg-accent" />}
									>
										{titleOf(session)}
									</MenuItem>
								))}
							</div>
						) : null}
						{closedMatches.length > 0 ? (
							<div>
								<p className="px-2 pt-2 pb-1 text-xs font-medium text-fg-subtle">Closed chats</p>
								{closedMatches.map((session) => (
									<MenuItem key={session.id} onSelect={() => void choose(session)}>
										{titleOf(session)}
									</MenuItem>
								))}
							</div>
						) : null}
						{query.trim().length > 0 && openMatches.length === 0 && closedMatches.length === 0 ? (
							<p className="px-2 py-3 text-sm text-fg-muted">No matching chats</p>
						) : null}
					</>
				)}
			</MenuContent>
		</Menu>
	);
}
