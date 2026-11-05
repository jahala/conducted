/**
 * @feature NAV-10 Tab strip
 * Owns: The row of tabs above the content: chats, terminals, files, review comments, the PR and
 * browser previews, with the '+' menu and chat history.
 * Behaviour: ui-map.md 3.2 (tab types with icon and close button; middle click closes; chat tab
 * fixed width with status icon, title and unread dot; '+' menu 'New chat', 'Browser', 'Local
 * terminal'; the tab limit; 'View chat history'), 5.4 (previous, next, close and reopen shortcuts).
 * Our design choice: The open chats and workspace terminals are the tabs. A file, comment, PR or
 * browser tab is the tab the URL names, so the URL stays the one source of truth for the open tab.
 * The tab limit is five, or ten with Tab Freak Mode. A browser URL that does not parse is shown as-is.
 * Must handle: Many tabs (scroll); at the tab limit (new-tab menu disabled); closing the active tab
 * opens its neighbour while closing another keeps the current tab; error card 'Tabs failed to load'
 * with Retry; reopening the last closed chat; a split group's tabs are left out of the main strip.
 * Test first: Closing the active middle tab selects the tab to its right; at the limit the '+'
 * menu is disabled.
 */
import { idleLiveState } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useServices } from "../../core/context.tsx";
import {
	useActions,
	useSessions,
	useSetting,
	useTerminals,
	useWorkspace,
} from "../../core/hooks.ts";
import type { DiffComment, Session, Terminal } from "../../core/model.ts";
import { deriveWorkspaceStatus } from "../../core/status/workspace-status.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { activeTabFromDescriptor, resolveActiveTab, searchPatchFor, tabRef } from "./active-tab.ts";
import { ChatHistoryButton } from "./ChatHistoryButton.tsx";
import { NewTabMenu } from "./NewTabMenu.tsx";
import { TabContextMenu } from "./TabContextMenu.tsx";
import { TabItem } from "./TabItem.tsx";
import { neighbourAfterClose, type TabDescriptor } from "./tab-layout.ts";
import { useNewTab } from "./useNewTab.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface TabStripProps {
	workspaceId: WorkspaceId;
	search: WorkspaceSearch;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
	/** Tabs that a split pane owns, so the main strip does not show them too. */
	excludeRefs?: ReadonlySet<string>;
}

const NO_COMMENTS: readonly DiffComment[] = [];

const hostOf = (url: string): string => {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
};

/** How a comment's author is shown in the tab title. */
function commentAuthor(comment: DiffComment | undefined): string | null {
	if (comment === undefined) return null;
	if (comment.author.name !== null && comment.author.name.trim() !== "") {
		return comment.author.name;
	}
	return comment.author.kind === "user" ? "You" : comment.author.kind;
}

/** The tab the URL names, when it is a file, comment, PR or browser tab. */
export function specialTab(
	search: WorkspaceSearch,
	prNumber: number | null,
	comments: readonly DiffComment[],
): TabDescriptor | null {
	const tab = resolveActiveTab(search);
	const ref = tabRef(tab);
	if (ref === null) return null;
	switch (tab.kind) {
		case "file":
			return {
				kind: "file",
				ref,
				title: tab.path,
				mode: tab.mode,
				scope: tab.scope,
				line: tab.line,
			};
		case "comment": {
			const author = commentAuthor(comments.find((comment) => comment.id === tab.commentId));
			return {
				kind: "comment",
				ref,
				title: author === null ? "Comment" : `Comment by ${author}`,
			};
		}
		case "pr":
			return { kind: "pr", ref, title: prNumber === null ? "PR" : `PR #${prNumber}` };
		case "browser":
			return {
				kind: "browser",
				ref,
				title: hostOf(tab.url),
			};
		default:
			return null;
	}
}

export function chatTabs(
	sessions: readonly Session[],
	liveStates: Record<string, typeof idleLiveState> = {},
	cancelling: Record<string, boolean> = {},
): TabDescriptor[] {
	return sessions.map((session) => {
		const status = deriveWorkspaceStatus({
			state: "ready",
			settingUp: false,
			chats: [
				{
					liveState: liveStates[session.id] ?? idleLiveState,
					cancelling: cancelling[session.id] === true,
					closed: false,
				},
			],
			git: null,
		});
		return {
			kind: "session",
			ref: tabRef({ kind: "session", sessionId: session.id }) ?? "",
			title: session.title ?? "New chat",
			sessionId: session.id,
			unread: session.unreadCount > 0,
			status,
		};
	});
}

export function terminalTabs(terminals: readonly Terminal[]): TabDescriptor[] {
	return terminals
		.filter((terminal) => terminal.kind === "terminal")
		.map((terminal, index) => ({
			kind: "terminal",
			ref: tabRef({ kind: "terminal", terminalId: terminal.id }) ?? "",
			title: terminal.title || `Terminal ${index + 1}`,
			terminalId: terminal.id,
		}));
}

/** The open tabs in reading order: chats, then terminals, then the tab the URL names. */
export function buildTabs({
	sessions,
	terminals,
	search,
	prNumber,
	comments = NO_COMMENTS,
	liveStates,
	cancelling,
}: {
	sessions: readonly Session[];
	terminals: readonly Terminal[];
	search: WorkspaceSearch;
	prNumber: number | null;
	comments?: readonly DiffComment[];
	liveStates?: Record<string, typeof idleLiveState>;
	cancelling?: Record<string, boolean>;
}): TabDescriptor[] {
	const special = specialTab(search, prNumber, comments);
	return [
		...chatTabs(sessions, liveStates, cancelling),
		...terminalTabs(terminals),
		...(special === null ? [] : [special]),
	];
}

const NOTHING: Partial<WorkspaceSearch> = {
	tab: undefined,
	sessionId: undefined,
	terminalId: undefined,
	path: undefined,
	commentId: undefined,
	browserUrl: undefined,
};

export function TabStrip({ workspaceId, search, onSearchChange, excludeRefs }: TabStripProps) {
	const actions = useActions();
	const services = useServices();
	const sessions = useSessions(workspaceId);
	const terminals = useTerminals(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const tabFreakMode = useSetting<boolean>("experimental_tab_freak_mode");
	const liveStates = useStore(services.services.sessions.store, (state) => state.liveStates);
	const cancelling = useStore(services.services.sessions.store, (state) => state.cancelling);
	const comments = useStore(
		services.services.review.store,
		(state) => state.byWorkspace[workspaceId] ?? NO_COMMENTS,
	);
	const lastClosed = useRef<TabDescriptor | null>(null);
	const [retrying, setRetrying] = useState(false);
	const retryFlight = useRef(createSingleFlight()).current;
	const newTab = useNewTab({ workspaceId, onSearchChange });

	const limit = tabFreakMode ? 10 : 5;
	const openSessions = sessions.state === "ready" ? sessions.data : [];
	const openTerminals = terminals.state === "ready" ? terminals.data : [];
	const prNumber = workspace.state === "ready" ? workspace.data.prNumber : null;
	const tabs = buildTabs({
		sessions: openSessions,
		terminals: openTerminals,
		search,
		prNumber,
		comments,
		liveStates,
		cancelling,
	}).filter((tab) => excludeRefs === undefined || !excludeRefs.has(tab.ref));

	const activeRef = tabRef(resolveActiveTab(search));

	const select = (tab: TabDescriptor) =>
		onSearchChange(searchPatchFor(activeTabFromDescriptor(tab)));
	const showNeighbour = (tab: TabDescriptor) => {
		const neighbour = neighbourAfterClose(tabs, tab.ref);
		if (neighbour === null) onSearchChange(NOTHING);
		else select(neighbour);
	};

	const close = async (tab: TabDescriptor) => {
		if (tab.kind === "session" && tab.sessionId !== undefined) {
			const result = await actions.sessions.close(tab.sessionId);
			if (!result.ok) {
				toastError("Couldn't close the chat", result.error);
				return;
			}
		}
		if (tab.kind === "terminal" && tab.terminalId !== undefined) {
			const result = await actions.terminals.close(tab.terminalId);
			if (!result.ok) {
				toastError("Couldn't close the terminal", result.error);
				return;
			}
		}
		lastClosed.current = tab;
		if (tab.ref === activeRef) showNeighbour(tab);
	};

	const go = (offset: number) => {
		if (tabs.length === 0) return;
		const index = tabs.findIndex((tab) => tab.ref === activeRef);
		const next = index === -1 ? tabs[0] : tabs[(index + offset + tabs.length) % tabs.length];
		if (next !== undefined) select(next);
	};

	const reopen = async (): Promise<boolean> => {
		const tab = lastClosed.current;
		if (tab === null) return false;
		if (tab.kind === "session" && tab.sessionId !== undefined) {
			const result = await actions.sessions.reopen(tab.sessionId);
			if (!result.ok) {
				toastError("Couldn't reopen the chat", result.error);
				return true;
			}
		}
		if (tab.kind === "terminal" && !tabs.some((current) => current.ref === tab.ref)) {
			toastError("Couldn't reopen the terminal", {
				message: "That terminal has ended. Open a new one from the + menu.",
			});
			return true;
		}
		select(tab);
		return true;
	};

	const active = tabs.find((tab) => tab.ref === activeRef) ?? null;
	const closable = openSessions.length + terminalTabs(openTerminals).length;
	const atTabLimit = closable >= limit;

	useCommandHandler("chat.newTab", "base", () => {
		if (atTabLimit) return false;
		void newTab.newChat(false);
		return true;
	});
	useCommandHandler("tab.previous", "base", () => {
		go(-1);
		return true;
	});
	useCommandHandler("tab.next", "base", () => {
		go(1);
		return true;
	});
	useCommandHandler("tab.close", "base", () => {
		if (active === null) return false;
		void close(active);
		return true;
	});
	useCommandHandler("tab.reopenClosed", "base", () => {
		void reopen();
		return true;
	});

	const retry = () =>
		retryFlight.run(`workspace:${workspaceId}:retry`, async () => {
			setRetrying(true);
			try {
				const chats = await services.services.sessions.start();
				const opened = await services.services.terminals.loadWorkspace(workspaceId);
				if (!chats.ok) toastError("Couldn't load the chats", chats.error);
				if (!opened.ok) toastError("Couldn't load the terminals", opened.error);
			} finally {
				setRetrying(false);
			}
		});

	const failed =
		(sessions.state === "error" && sessions.error) ||
		(terminals.state === "error" && terminals.error) ||
		false;

	if (failed) {
		return (
			<div className="flex h-10 items-center border-b border-separator px-4">
				<EmptyState
					compact
					tone="failed"
					title="Tabs failed to load"
					body={failed.message}
					action={
						<Button variant="secondary" size="sm" loading={retrying} onClick={() => void retry()}>
							Retry
						</Button>
					}
				/>
			</div>
		);
	}

	const loading = sessions.state === "loading" || terminals.state === "loading";

	return (
		<div
			role="tablist"
			aria-label="Workspace tabs"
			className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-separator bg-surface px-4"
		>
			{tabs.map((tab) => {
				const item = (
					<TabItem
						tab={tab}
						active={tab.ref === activeRef}
						onSelect={() => select(tab)}
						onClose={() => void close(tab)}
						onDragStart={(event) => {
							event.dataTransfer.setData("application/x-conducted-tab", tab.ref);
							event.dataTransfer.effectAllowed = "move";
							if (typeof event.dataTransfer.setDragImage === "function") {
								event.dataTransfer.setDragImage(event.currentTarget, 0, 0);
							}
						}}
					/>
				);
				const session =
					tab.kind === "session" && tab.sessionId !== undefined
						? openSessions.find((candidate) => candidate.id === tab.sessionId)
						: undefined;
				if (session === undefined) return item;
				return (
					<TabContextMenu
						key={tab.ref}
						sessionId={session.id}
						session={session}
						workspaceId={workspaceId}
						onClose={() => void close(tab)}
					>
						<div className="flex shrink-0">{item}</div>
					</TabContextMenu>
				);
			})}
			{loading && tabs.length === 0 ? (
				<span role="status" className="px-2 text-xs text-fg-subtle">
					Loading tabs
				</span>
			) : null}
			<NewTabMenu
				workspaceId={workspaceId}
				atTabLimit={atTabLimit}
				onSearchChange={onSearchChange}
			/>
			<ChatHistoryButton workspaceId={workspaceId} onSearchChange={onSearchChange} />
		</div>
	);
}
