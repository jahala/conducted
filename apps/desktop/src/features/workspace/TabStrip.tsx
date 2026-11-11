/**
 * @feature NAV-10 Tab strip; CHAT-16 Fork a chat from a turn
 * Owns: The row of tabs above the content: chats, terminals, files, review comments, the PR and
 * browser previews, with the '+' menu and chat history.
 * Behaviour: ui-map.md 3.2 (tab types with icon and close button; middle click closes; chat tab
 * fixed width with status icon, title and unread dot; '+' menu 'New chat', 'Browser', 'Local
 * terminal'; the tab limit; 'View chat history'; chat tab menu 'Fork to new tab'), 5.4 (previous,
 * next, close, reopen and fork shortcuts).
 * Our design choice: The open chats and workspace terminals are the tabs. A file, comment, PR or
 * browser tab is the tab the URL names, so the URL stays the one source of truth for the open tab.
 * The tab limit is five, or ten with Tab Freak Mode. A browser URL that does not parse is shown as-is.
 * Must handle: Many tabs (scroll); at the tab limit (new-tab menu disabled); closing the active tab
 * opens its neighbour while closing another keeps the current tab; a working chat asks before it
 * closes (CloseChatDialog), then its agent stops and the next chat opens, with a new chat when it
 * was the last; 'Close others' asks once for the working chats and closes the other chats and
 * terminals, keeping the chosen tab; error card 'Tabs failed to load'
 * with Retry; reopening the last closed chat; a split group's tabs are left out of the main strip.
 * Test first: Closing the active middle tab selects the tab to its right; at the limit the '+'
 * menu is disabled.
 */
import { idleLiveState } from "@conducted/protocol";
import { appError, type SessionId, type WorkspaceId } from "@conducted/shared";
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
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
import { chatIsWorking } from "../../core/sessions.ts";
import { deriveWorkspaceStatus } from "../../core/status/workspace-status.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { activeTabFromDescriptor, resolveActiveTab, searchPatchFor, tabRef } from "./active-tab.ts";
import { ChatHistoryButton } from "./ChatHistoryButton.tsx";
import { CloseChatDialog } from "./CloseChatDialog.tsx";
import { NewTabMenu } from "./NewTabMenu.tsx";
import { TabContextMenu } from "./TabContextMenu.tsx";
import { TabItem } from "./TabItem.tsx";
import { neighbourAfterClose, type TabDescriptor } from "./tab-layout.ts";
import { useNewTab } from "./useNewTab.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

/** The pointer drag the split panes own, so a tab starts one and a drag's click selects nothing. */
export interface TabPointer {
	start(event: ReactPointerEvent, tab: TabDescriptor): void;
	consumeClick(event: { detail: number; preventDefault(): void; stopPropagation(): void }): boolean;
}

export interface TabStripProps {
	workspaceId: WorkspaceId;
	search: WorkspaceSearch;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
	/** Tabs that a split pane owns, so the main strip does not show them too. */
	excludeRefs?: ReadonlySet<string>;
	/** The drag the split panes own. Without it the strip is not a drag source. */
	pointer?: TabPointer;
	/** The group this strip shows, as SplitPanes names it. */
	group?: string;
	/** The tab refs in the order the user last dragged them; unlisted tabs follow in their own order. */
	order?: readonly string[];
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

/** A workspace's terminal tabs. A cloud workspace shows each terminal's host (CLOUD-09). */
export function terminalTabs(
	terminals: readonly Terminal[],
	hostKind?: "local" | "cloud",
): TabDescriptor[] {
	return terminals
		.filter((terminal) => terminal.kind === "terminal")
		.map((terminal, index) => ({
			kind: "terminal",
			ref: tabRef({ kind: "terminal", terminalId: terminal.id }) ?? "",
			title: terminal.title || `Terminal ${index + 1}`,
			terminalId: terminal.id,
			...(hostKind === undefined ? {} : { hostKind }),
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
	workspaceHostKind,
}: {
	sessions: readonly Session[];
	terminals: readonly Terminal[];
	search: WorkspaceSearch;
	prNumber: number | null;
	comments?: readonly DiffComment[];
	liveStates?: Record<string, typeof idleLiveState>;
	cancelling?: Record<string, boolean>;
	/** A cloud workspace marks each terminal tab with its host (CLOUD-09). */
	workspaceHostKind?: "local" | "cloud";
}): TabDescriptor[] {
	const special = specialTab(search, prNumber, comments);
	return [
		...chatTabs(sessions, liveStates, cancelling),
		...terminalTabs(terminals, workspaceHostKind === "cloud" ? "cloud" : undefined),
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

export function TabStrip({
	workspaceId,
	search,
	onSearchChange,
	excludeRefs,
	pointer,
	group = "group-main",
	order,
}: TabStripProps) {
	const actions = useActions();
	const services = useServices();
	const sessions = useSessions(workspaceId);
	const terminals = useTerminals(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const tabFreakMode = useSetting<boolean>("experimental_tab_freak_mode");
	const forkEnabled = useSetting<boolean>("experimental_fork_to_new_tab") === true;
	const liveStates = useStore(services.services.sessions.store, (state) => state.liveStates);
	const cancelling = useStore(services.services.sessions.store, (state) => state.cancelling);
	const comments = useStore(
		services.services.review.store,
		(state) => state.byWorkspace[workspaceId] ?? NO_COMMENTS,
	);
	const lastClosed = useRef<TabDescriptor | null>(null);
	const [retrying, setRetrying] = useState(false);
	const retryFlight = useRef(createSingleFlight()).current;
	const forkFlight = useRef(createSingleFlight()).current;
	const newTab = useNewTab({ workspaceId, onSearchChange });

	const limit = tabFreakMode ? 10 : 5;
	const openSessions = sessions.state === "ready" ? sessions.data : [];
	const openTerminals = terminals.state === "ready" ? terminals.data : [];
	const prNumber = workspace.state === "ready" ? workspace.data.prNumber : null;
	const naturalTabs = buildTabs({
		sessions: openSessions,
		terminals: openTerminals,
		search,
		prNumber,
		comments,
		liveStates,
		cancelling,
		workspaceHostKind:
			workspace.state === "ready" && workspace.data.host.kind === "cloud" ? "cloud" : undefined,
	}).filter((tab) => excludeRefs === undefined || !excludeRefs.has(tab.ref));
	// A saved drag order first; tabs opened since then keep their place after it.
	const ranks =
		order === undefined ? undefined : new Map(order.map((ref, position) => [ref, position]));
	const tabs =
		ranks === undefined
			? naturalTabs
			: [...naturalTabs].sort(
					(left, right) =>
						(ranks.get(left.ref) ?? Number.MAX_SAFE_INTEGER) -
						(ranks.get(right.ref) ?? Number.MAX_SAFE_INTEGER),
				);

	const activeRef = tabRef(resolveActiveTab(search));

	const select = (tab: TabDescriptor) =>
		onSearchChange(searchPatchFor(activeTabFromDescriptor(tab)));
	const showNeighbour = (tab: TabDescriptor) => {
		const neighbour = neighbourAfterClose(tabs, tab.ref);
		if (neighbour === null) onSearchChange(NOTHING);
		else select(neighbour);
	};

	/** A close the dialog is asking about: one chat, or every other chat of the strip. */
	type PendingClose =
		| { kind: "chat"; tab: TabDescriptor; session: Session }
		| { kind: "others"; keep: TabDescriptor; sessions: readonly Session[] };
	const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);

	const isWorking = (sessionId: SessionId): boolean =>
		chatIsWorking({ liveStates, cancelling }, sessionId);

	/** Closes the chat or terminal behind a tab. Other tab kinds close by leaving the URL. */
	const closeBacking = async (
		tab: TabDescriptor,
	): Promise<{ ok: true; next?: Session } | { ok: false }> => {
		if (tab.kind === "session" && tab.sessionId !== undefined) {
			const result = await actions.sessions.close(tab.sessionId);
			if (!result.ok) {
				toastError("Couldn't close the chat", result.error);
				return { ok: false };
			}
			return { ok: true, next: result.value };
		}
		if (tab.kind === "terminal" && tab.terminalId !== undefined) {
			const result = await actions.terminals.close(tab.terminalId);
			if (!result.ok) {
				toastError("Couldn't close the terminal", result.error);
				return { ok: false };
			}
		}
		return { ok: true };
	};

	const closeNow = async (tab: TabDescriptor) => {
		const result = await closeBacking(tab);
		if (!result.ok) return;
		lastClosed.current = tab;
		if (tab.ref !== activeRef) return;
		// Conductor's close makes the next chat active and opens it. A replacement chat is opened
		// the same way when the last chat closed.
		if (result.next !== undefined) {
			onSearchChange(searchPatchFor({ kind: "session", sessionId: result.next.id }));
			return;
		}
		showNeighbour(tab);
	};

	/** Asks first when the chat is working, as Conductor does; otherwise closes it at once. */
	const close = async (tab: TabDescriptor) => {
		if (tab.kind === "session" && tab.sessionId !== undefined) {
			const session = openSessions.find((candidate) => candidate.id === tab.sessionId);
			if (session !== undefined && isWorking(session.id)) {
				setPendingClose({ kind: "chat", tab, session });
				return;
			}
		}
		await closeNow(tab);
	};

	const othersClosable = (keep: TabDescriptor): TabDescriptor[] =>
		tabs.filter(
			(other) => other.ref !== keep.ref && (other.kind === "session" || other.kind === "terminal"),
		);

	const closeOthersNow = async (keep: TabDescriptor) => {
		for (const other of othersClosable(keep)) {
			const result = await closeBacking(other);
			if (!result.ok) return;
			lastClosed.current = other;
		}
		if (keep.ref !== activeRef) select(keep);
	};

	/** "Close others" asks once for all the working chats, as Conductor's dialog does. */
	const closeOthers = async (keep: TabDescriptor) => {
		const working = othersClosable(keep).flatMap((tab) => {
			if (tab.kind !== "session" || tab.sessionId === undefined) return [];
			const session = openSessions.find((candidate) => candidate.id === tab.sessionId);
			return session !== undefined && isWorking(session.id) ? [session] : [];
		});
		if (working.length > 0) {
			setPendingClose({ kind: "others", keep, sessions: working });
			return;
		}
		await closeOthersNow(keep);
	};

	const confirmPendingClose = () => {
		const pending = pendingClose;
		if (pending === null) return;
		setPendingClose(null);
		if (pending.kind === "chat") void closeNow(pending.tab);
		else void closeOthersNow(pending.keep);
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

	/**
	 * Forks a chat from its latest checkpointed turn and opens the new tab (CHAT-16). A finished
	 * turn is preferred so the copy ends on a whole turn; a chat with only a running turn forks
	 * from that turn. No checkpoint at all is reported as "Unable to fork chat".
	 */
	const fork = (sessionId: SessionId): void => {
		void forkFlight.run(`workspace:${workspaceId}:fork:${sessionId}`, async () => {
			const opened = await services.services.sessions.open(sessionId);
			if (!opened.ok) {
				toastError("Unable to fork chat", opened.error);
				return;
			}
			const turns = services.services.sessions.chatView(sessionId)?.turns ?? [];
			const reversed = [...turns].reverse();
			const turn =
				reversed.find((candidate) => candidate.endCheckpointId !== null) ??
				reversed.find((candidate) => candidate.startCheckpointId !== null);
			if (turn === undefined) {
				toastError(
					"Unable to fork chat",
					appError("chat_fork_no_checkpoint", "Checkpoint not found for this turn."),
				);
				return;
			}
			const forked = await actions.sessions.forkFrom(sessionId, turn.turnId);
			if (!forked.ok) {
				toastError("Unable to fork chat", forked.error);
				return;
			}
			onSearchChange({ tab: "session", sessionId: forked.value.id });
		});
	};

	const active = tabs.find((tab) => tab.ref === activeRef) ?? null;
	const closable = openSessions.length + terminalTabs(openTerminals).length;
	const atTabLimit = closable >= limit;
	const hasOtherClosable = closable > 1;

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
	useCommandHandler("chat.fork", "base", () => {
		if (!forkEnabled) return false;
		if (active === null || active.kind !== "session" || active.sessionId === undefined) {
			return false;
		}
		fork(active.sessionId);
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
	const representative =
		pendingClose === null
			? null
			: pendingClose.kind === "chat"
				? pendingClose.session
				: (pendingClose.sessions[0] ?? null);
	const runningCount =
		pendingClose === null ? 0 : pendingClose.kind === "chat" ? 1 : pendingClose.sessions.length;

	return (
		<>
			<div
				role="tablist"
				aria-label="Workspace tabs"
				data-tab-strip={group}
				className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-separator bg-surface px-4"
			>
				{tabs.map((tab) => {
					const item = (
						<TabItem
							key={tab.ref}
							tab={tab}
							active={tab.ref === activeRef}
							data-tab-ref={tab.ref}
							onSelect={() => select(tab)}
							onClose={() => void close(tab)}
							onPointerDown={(event) => pointer?.start(event, tab)}
							onClickCapture={pointer?.consumeClick}
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
							onCloseOthers={hasOtherClosable ? () => void closeOthers(tab) : undefined}
							forkEnabled={forkEnabled}
							onFork={() => fork(session.id)}
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
			<CloseChatDialog
				open={pendingClose !== null}
				onOpenChange={(open) => {
					if (!open) setPendingClose(null);
				}}
				runningCount={runningCount}
				session={representative}
				waiting={
					representative !== null && liveStates[representative.id]?.waitingSince !== undefined
				}
				onConfirm={confirmPendingClose}
			/>
		</>
	);
}
