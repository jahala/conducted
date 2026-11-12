/**
 * @feature CHAT-06 Message list; CHAT-27 Visible auto-retry with Retry now; CHAT-25 Turn outline
 * Owns: The virtualised list of turns in a chat, with a header that loads older history, a footer
 * for the live state, the running turn's retry line, the scroll-to-bottom behaviour, and the turn
 * outline beside the list.
 * Behaviour: frontend.md 5 (one virtualised item per turn, keyed by turn id; Header for history
 * loading; Footer; a 'Scroll to bottom' button over the list; increaseViewportBy 600), ui-map.md
 * 3.3 (list; 'Something went wrong, retrying n/m' with Retry now on the running turn). The chat
 * opens on its last turns (CHAT-06, #617). While older turns are stored, the header reads
 * "Loading messages…" and, each time the list's top is within 800 pixels, loads one more turn; a
 * failed load reads "Couldn't load messages" with Retry (renderApp `_ma` @9596613, `tWt`
 * @9596053). Until the turns fill the list, or nothing is older, or a load failed, or 5 seconds
 * passed, the list is hidden under the loading skeleton (`Wma` @9609810, `vma` @9597304).
 * Our design choice: Built on react-virtuoso's Virtuoso (MIT) instead of the commercial
 * VirtuosoMessageList. Use data + computeItemKey (turn id), increaseViewportBy, followOutput
 * (follow only while the user is at the bottom, via atBottomStateChange), components.Header and
 * components.Footer, and a ref to scrollToIndex, which the chat pane may own so its find bar can
 * scroll to a turn the list has not mounted. Only a turn that changed redraws: TurnItem is
 * memoised on the turn object, and the service (CHAT-07) keeps every unchanged turn the same
 * object. While a reply streams that is the newest turn; when a background helper's late work
 * reaches the card of an earlier turn, it is that turn too (D129).
 * The list opens at its end (the last turn's footer in view, as Conductor does), and its footer holds the
 * working line while the agent works. Older turns join at the top through `firstItemIndex`, which
 * falls by one for each, so the turns on screen stay where they are. Picking a turn in the outline
 * that is not loaded loads every turn back to it, then scrolls to it (D142).
 * Must handle: Loading (skeleton turns); an error card and the running turn's retry line (their
 * actions live in TurnItem and ChatBanner); empty chat (EmptyChat with starters, or none in an
 * archived workspace; the composer bar says the workspace is read-only); a turn added while the
 * user reads old messages (no jump, show Scroll to bottom);
 * the chat switches (list resets to the bottom); older turns loading at the top while the user reads
 * (no jump); a very long turn; each turn in its own boundary
 * 'This chat turn failed to render. Other turns are still available.'; 2000 turns stay smooth (tested at that size).
 * Test first: With 2000 turns only a small window of TurnItem is mounted; appending a block to the
 * last turn re-renders only that item.
 */
import type { LiveState } from "@conducted/protocol";
import type { SessionId, TurnId, WorkspaceId } from "@conducted/shared";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useActions, useChat, useDraft, useSetting, useWorkspace } from "../../core/hooks.ts";
import type { ChatHistoryView, ChatView } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { EmptyChat } from "./EmptyChat.tsx";
import { reportFailure } from "./report-failure.ts";
import { ScrollToBottomButton } from "./ScrollToBottomButton.tsx";
import { TurnItem } from "./TurnItem.tsx";
import { TurnOutline } from "./TurnOutline.tsx";
import { WorkingLine } from "./WorkingLine.tsx";

export interface MessageListProps {
	sessionId: SessionId;
	workspaceId: WorkspaceId;
	/**
	 * The list's handle, when the parent scrolls it too (the chat pane's find bar, CHAT-17). Without
	 * one, the list keeps its own handle for the Scroll to bottom button.
	 */
	listRef?: RefObject<VirtuosoHandle | null>;
}

/** Older turns load while the list's top is this close, in pixels, as in Conductor (`jQi`). */
const LOAD_OLDER_WITHIN_PX = 800;
/** The longest the list stays hidden while older turns fill it, as in Conductor (`$ma`). */
const REVEAL_AFTER_MS = 5_000;

function LoadingTurns({ className }: { className?: string }) {
	return (
		<div className={cn("flex flex-col gap-4 p-7", className)}>
			{[0, 1, 2].map((row) => (
				<div key={row} className="flex flex-col gap-2">
					<Skeleton className="ml-auto h-10 w-2/5" />
					<Skeleton className="h-4 w-4/5" />
					<Skeleton className="h-4 w-3/5" />
				</div>
			))}
		</div>
	);
}

/** The top of the list: older turns loading, or Retry when a load failed, or a little room. */
function HistoryHeader({ context }: { context?: ListContext }) {
	const older = context?.older ?? null;
	if (older === null) {
		return <div data-region="history-header" className="h-3" aria-hidden="true" />;
	}
	return (
		<div
			data-region="history-header"
			className="flex h-8 items-center justify-center gap-2 text-xs text-fg-subtle"
		>
			{older.state === "failed" ? (
				<div role="alert" className="flex items-center gap-2">
					Couldn't load messages
					<Button variant="outline" size="xs" className="text-fg" onClick={older.retry}>
						Retry
					</Button>
				</div>
			) : (
				<>
					<Spinner size="sm" label="Loading messages" />
					<span aria-hidden="true">Loading messages…</span>
				</>
			)}
		</div>
	);
}

interface ListContext {
	/** Older turns are stored: whether a load failed, and how to try again. Null: none are. */
	older: { state: ChatHistoryView["older"]; retry: () => void } | null;
	/** Set while the agent works: when the last turn's message was sent, and any background wait. */
	working: {
		since: number;
		waiting?: { since: number; tasks: LiveState["backgroundTasks"] };
	} | null;
}

/** The end of the list: the working line while the agent works, then 25px of room (Conductor's footer). */
function ListFooter({ context }: { context?: ListContext }) {
	const working = context?.working ?? null;
	return (
		<div data-region="list-footer" className="pb-6">
			{working === null ? null : <WorkingLine since={working.since} waiting={working.waiting} />}
		</div>
	);
}

/**
 * The list's own count for the first loaded turn: how many older turns are not loaded. It falls by
 * one for each older turn that joins at the top, so the list keeps the turns on screen still.
 */
function firstItemIndexOf(data: ChatView): number {
	return data.outline.length - data.turns.length;
}

function workingOf(data: ChatView): ListContext["working"] {
	if (data.liveState.status !== "working") return null;
	const last = data.turns.at(-1);
	const since = last?.userMessage?.at ?? last?.startedAt ?? Date.now();
	const waitingSince = data.liveState.waitingSince;
	return waitingSince === undefined
		? { since }
		: { since, waiting: { since: waitingSince, tasks: data.liveState.backgroundTasks } };
}

export function MessageList({ sessionId, workspaceId, listRef: parentListRef }: MessageListProps) {
	const chat = useChat(sessionId);
	const workspace = useWorkspace(workspaceId);
	const archived = workspace.state === "ready" && isArchivedWorkspace(workspace.data);
	const canRun = workspace.state === "ready" && workspace.data.state === "ready";
	const draft = useDraft(sessionId);
	const actions = useActions();
	const expandAll = useSetting<boolean>("garry_mode");
	const ownListRef = useRef<VirtuosoHandle>(null);
	const listRef = parentListRef ?? ownListRef;
	const [atBottom, setAtBottom] = useState(true);
	const [currentTurnId, setCurrentTurnId] = useState<TurnId | null>(null);
	const [nearTop, setNearTop] = useState(false);
	// The chat whose list is shown: set once its turns fill the list, or there is nothing to wait for.
	const [revealedFor, setRevealedFor] = useState<SessionId | null>(null);
	// A turn the outline picked that is loading; the list scrolls to it once it is there.
	const [jumpTo, setJumpTo] = useState<TurnId | null>(null);
	const frameRef = useRef<HTMLDivElement | null>(null);

	const view = chat.state === "ready" ? chat.data : null;
	const olderTurnId = view?.history.olderTurnId ?? null;
	const older = view?.history.older ?? "idle";
	const loadOlder = () => {
		void actions.sessions.loadOlder(sessionId);
	};
	// One more turn each time the top is near and nothing is loading, as Conductor's header does.
	// A failed load waits for Retry.
	useEffect(() => {
		if (nearTop && olderTurnId !== null && older === "idle") {
			void actions.sessions.loadOlder(sessionId);
		}
	}, [actions, nearTop, older, olderTurnId, sessionId]);

	const settled = view !== null && (olderTurnId === null || older === "failed");
	const revealed = revealedFor === sessionId || settled;
	useEffect(() => {
		if (settled) setRevealedFor(sessionId);
	}, [settled, sessionId]);
	const showing = view !== null;
	useEffect(() => {
		if (revealed || !showing) return;
		const timer = setTimeout(() => setRevealedFor(sessionId), REVEAL_AFTER_MS);
		return () => clearTimeout(timer);
	}, [revealed, showing, sessionId]);

	const turnIndex = (turnId: TurnId): number =>
		view === null ? -1 : view.turns.findIndex((turn) => turn.turnId === turnId);
	useEffect(() => {
		if (jumpTo === null || view === null) return;
		const index = view.turns.findIndex((turn) => turn.turnId === jumpTo);
		if (index < 0) return;
		setJumpTo(null);
		listRef.current?.scrollToIndex({ index, align: "start" });
	}, [jumpTo, view, listRef]);
	const jumpToTurn = (turnId: TurnId) => {
		const index = turnIndex(turnId);
		if (index >= 0) {
			listRef.current?.scrollToIndex({ index, align: "start" });
			return;
		}
		setJumpTo(turnId);
		void actions.sessions.revealTurn(sessionId, turnId).then((result) => {
			if (result.ok) return;
			setJumpTo(null);
			toastError("Couldn't load messages", result.error);
		});
	};

	useCommandHandler("chat.expandAllToolCalls", "area", () => {
		void reportFailure(
			actions.settings.set("garry_mode", !expandAll),
			"Couldn't change the tool call setting",
		);
		return true;
	});

	const pickStarter = (prompt: string) => {
		const text =
			draft.text.trim().length === 0 ? prompt : `${draft.text.replace(/\s+$/, "")}\n\n${prompt}`;
		actions.sessions.saveDraft(sessionId, {
			text,
			attachmentPaths: [...draft.attachmentPaths],
		});
	};

	return (
		<LoadableView
			value={chat}
			loadingLabel="Loading messages"
			loading={<LoadingTurns />}
			errorTitle="Error loading messages"
		>
			{(data: ChatView) =>
				data.turns.length === 0 ? (
					<EmptyChat
						onPick={pickStarter}
						archived={archived}
						sessionId={sessionId}
						workspaceId={workspaceId}
						directory={workspace.state === "ready" ? workspace.data.directoryName : undefined}
					/>
				) : (
					<div className="relative h-full min-h-0">
						{revealed ? null : <LoadingTurns className="absolute inset-x-0 top-0" />}
						{/* The list, its outline and its button stay hidden while older turns fill it. */}
						<div
							ref={frameRef}
							className={cn("relative h-full", !revealed && "opacity-0")}
							inert={!revealed}
						>
							<Virtuoso
								key={sessionId}
								ref={listRef}
								data={data.turns}
								firstItemIndex={firstItemIndexOf(data)}
								computeItemKey={(_, turn) => turn.turnId}
								itemContent={(_, turn) => (
									<TurnItem
										turn={turn}
										sessionId={sessionId}
										workspaceId={workspaceId}
										canRun={canRun}
										retry={turn === data.turns.at(-1) ? data.liveState.retry : undefined}
										expandAll={expandAll === true}
										agent={data.session.config.agent}
									/>
								)}
								context={{
									working: workingOf(data),
									older:
										data.history.olderTurnId === null
											? null
											: { state: data.history.older, retry: loadOlder },
								}}
								initialTopMostItemIndex={{ index: "LAST", align: "end" }}
								increaseViewportBy={600}
								followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
								atBottomStateChange={setAtBottom}
								atTopThreshold={LOAD_OLDER_WITHIN_PX}
								atTopStateChange={setNearTop}
								totalListHeightChanged={(height) => {
									// The frame is the list's own height: the turns fill it once they are taller.
									const shown = frameRef.current?.clientHeight ?? 0;
									if (shown > 0 && height > shown) setRevealedFor(sessionId);
								}}
								rangeChanged={(range) => {
									// The list counts from `firstItemIndex`; `data.turns` from zero.
									const turn = data.turns[range.startIndex - firstItemIndexOf(data)];
									if (turn === undefined) return;
									setCurrentTurnId((previous) =>
										previous === turn.turnId ? previous : turn.turnId,
									);
								}}
								components={{ Header: HistoryHeader, Footer: ListFooter }}
								className="h-full"
							/>
							<div className="absolute right-2 top-1/2 z-10 -translate-y-1/2">
								<TurnOutline
									turns={data.outline}
									currentTurnId={currentTurnId}
									onJumpToTurn={jumpToTurn}
								/>
							</div>
							<ScrollToBottomButton
								visible={!atBottom}
								hasNew={!atBottom && data.liveState.status === "working"}
								onClick={() =>
									listRef.current?.scrollToIndex({
										index: data.turns.length - 1,
										behavior: "smooth",
									})
								}
							/>
						</div>
					</div>
				)
			}
		</LoadableView>
	);
}
