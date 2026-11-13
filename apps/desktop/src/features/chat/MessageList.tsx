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
 * falls by the number of turns that join above the first one, so the turns on screen stay where
 * they are. Picking a turn in the outline that is not loaded loads that turn alone and scrolls to it;
 * a gap marker then sits above the first loaded turn after it, reads like the header, and when it
 * comes within 800 pixels loads one turn of the gap: the one after the earlier turns when the
 * marker is below the middle of the list, else the one before the later turns (renderApp `FQi`,
 * `yma` @9597304, `Gma` @9610295, #652). The list keeps the turn the user reads at its top where it
 * stood: a turn joining above it moves the list by what it adds, as Conductor's message list holds
 * its view still.
 * Must handle: a gap's fill that fails (Couldn't load messages with Retry on the marker); a gap that
 * closes; Loading (skeleton turns); an error card and the running turn's retry line (their
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
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useActions, useChat, useDraft, useSetting, useWorkspace } from "../../core/hooks.ts";
import type { ChatHistoryView, ChatView, GapSide } from "../../core/model.ts";
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
/** Frames a held turn must stay put before the list stops holding it, after a gap's fill. */
const HOLD_STILL_FRAMES = 3;
/** The most frames the list holds a turn after a gap's fill, so a list that never settles stops. */
const HOLD_LIMIT_FRAMES = 120;

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

/** Turns loading, or "Couldn't load messages" with Retry: the header's row and a gap's (`tWt`). */
function HistoryLoadRow({ onRetry }: { onRetry?: () => void }) {
	if (onRetry !== undefined) {
		return (
			<div
				role="alert"
				className="flex h-8 items-center justify-center gap-2 text-xs text-fg-subtle"
			>
				Couldn't load messages
				<Button variant="outline" size="xs" className="text-fg" onClick={onRetry}>
					Retry
				</Button>
			</div>
		);
	}
	return (
		<div className="flex h-8 items-center justify-center gap-2 text-xs text-fg-subtle">
			<Spinner size="sm" label="Loading messages" />
			<span aria-hidden="true">Loading messages…</span>
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
		<div data-region="history-header">
			<HistoryLoadRow onRetry={older.state === "failed" ? older.retry : undefined} />
		</div>
	);
}

/**
 * Which side of a gap to fill, as Conductor's `yma` picks: the turn before the later turns when the
 * list is at its bottom or the marker is in the top half, else the turn after the earlier ones.
 */
function gapSide(marker: HTMLElement, scroller: HTMLElement | null, atBottom: boolean): GapSide {
	if (scroller === null || atBottom) return "before-later";
	const list = scroller.getBoundingClientRect();
	const { top, bottom } = marker.getBoundingClientRect();
	return (top + bottom) / 2 > list.top + list.height / 2 ? "after-earlier" : "before-later";
}

/** Where a turn's item stands on screen, or null when the list has not drawn it. */
function turnTop(frame: HTMLElement | null, turnId: string): number | null {
	const element = frame?.querySelector<HTMLElement>(`[data-turn="${CSS.escape(turnId)}"]`);
	return element === null || element === undefined ? null : element.getBoundingClientRect().top;
}

/** The first turn the list shows at its top: the one the user reads, and where it stands. */
function topTurn(
	frame: HTMLElement | null,
	scroller: HTMLElement,
): { turnId: string; top: number } | null {
	const edge = scroller.getBoundingClientRect().top;
	for (const element of frame?.querySelectorAll<HTMLElement>("[data-turn]") ?? []) {
		const box = element.getBoundingClientRect();
		const turnId = element.dataset.turn;
		if (box.bottom > edge && turnId !== undefined) return { turnId, top: box.top };
	}
	return null;
}

/**
 * The turn a gap's fill loads, read from the outline: the one before the later turns, or the one
 * after the last loaded turn above the gap.
 */
function gapTurnId(data: ChatView, beforeTurnId: TurnId, side: GapSide): TurnId | null {
	const at = data.outline.findIndex((entry) => entry.turnId === beforeTurnId);
	if (at < 1) return null;
	if (side === "before-later") return data.outline[at - 1]?.turnId ?? null;
	const loaded = new Set(data.turns.map((turn) => turn.turnId));
	let index = at - 1;
	while (index > 0 && !loaded.has(data.outline[index - 1]?.turnId as TurnId)) index -= 1;
	return data.outline[index]?.turnId ?? null;
}

/**
 * The marker of a gap between loaded turns. Each time it comes within 800 pixels of the list it
 * asks for one more turn, once until it leaves again, as Conductor's `FQi` does; while the list
 * still takes in a turn it asked for, the marker waits.
 */
function GapMarker({
	gap,
	scroller,
	atBottom,
	ready,
	onFill,
}: {
	gap: ChatHistoryView["gaps"][number];
	scroller: HTMLElement | null;
	atBottom: boolean;
	/** False while the list still takes in the last turn it asked for. */
	ready: boolean;
	onFill: (side: GapSide, marker: HTMLElement) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [near, setNear] = useState(false);
	const asked = useRef(false);
	useEffect(() => {
		const marker = ref.current;
		if (marker === null || scroller === null) return;
		const observer = new IntersectionObserver(
			(entries) => setNear(entries[0]?.isIntersecting ?? false),
			{ root: scroller, rootMargin: `${LOAD_OLDER_WITHIN_PX}px 0px` },
		);
		observer.observe(marker);
		return () => observer.disconnect();
	}, [scroller]);
	const fill = () => {
		const marker = ref.current;
		if (marker !== null) onFill(gapSide(marker, scroller, atBottom), marker);
	};
	const idle = gap.state === "idle";
	useEffect(() => {
		if (!near) {
			asked.current = false;
			return;
		}
		if (!idle || !ready || asked.current) return;
		asked.current = true;
		fill();
	});
	return (
		<div ref={ref} data-transcript-gap-marker="">
			<HistoryLoadRow onRetry={gap.state === "failed" ? fill : undefined} />
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
 * The list's own count for its first turn. It starts at the number of turns older than the first
 * loaded one, so every one of them can join above, and falls by the number of turns that joined
 * above the turn that was first, so Virtuoso keeps the turns on screen still; a turn that joins in a
 * gap lower down does not move it. A new chat starts again.
 */
function useFirstItemIndex(sessionId: SessionId, data: ChatView | null): number {
	const kept = useRef<{ sessionId: SessionId; firstTurnId: TurnId | null; index: number } | null>(
		null,
	);
	const turns = data?.turns ?? [];
	const previous = kept.current;
	const firstTurnId = turns[0]?.turnId ?? null;
	let index = data === null ? 0 : data.outline.length - turns.length;
	if (previous !== null && previous.sessionId === sessionId && previous.firstTurnId !== null) {
		index = previous.index;
		if (previous.firstTurnId !== firstTurnId) {
			const joined = turns.findIndex((turn) => turn.turnId === previous.firstTurnId);
			if (joined > 0) index -= joined;
		}
	}
	kept.current = { sessionId, firstTurnId, index };
	return index;
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
	// One more older turn each time the top is near and nothing is loading, as Conductor's header
	// does; not while a gap's turn is being drawn with the view held still. A failed load waits for
	// Retry.
	const [holding, setHolding] = useState(false);
	useEffect(() => {
		if (!holding && nearTop && olderTurnId !== null && older === "idle") {
			void actions.sessions.loadOlder(sessionId);
		}
	}, [actions, holding, nearTop, older, olderTurnId, sessionId]);
	// A gap's marker asks for one turn at a time. The list says where its turns stand only once it
	// has taken in the turns it was given, a frame or more after they change; Conductor's list takes
	// in a turn at once. So the next fill, and the hold of a filled turn, wait until the list has
	// reported back since the last turn joined: it counts the turns not loaded when it reports, and
	// that count must be the current one.
	const notLoaded = view === null ? 0 : view.outline.length - view.turns.length;
	const notLoadedRef = useRef(notLoaded);
	notLoadedRef.current = notLoaded;
	const [reported, setReported] = useState<{ sessionId: SessionId; notLoaded: number } | null>(
		null,
	);
	const listReported = useCallback(() => {
		setReported((previous) =>
			previous?.sessionId === sessionId && previous.notLoaded === notLoadedRef.current
				? previous
				: { sessionId, notLoaded: notLoadedRef.current },
		);
	}, [sessionId]);
	const listCaughtUp = reported?.sessionId === sessionId && reported.notLoaded === notLoaded;
	const caughtUp = listCaughtUp && !holding;

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

	// A gap's fill: the turn the user reads at the list's top and where it stood, so the list can
	// move by what a turn joining above it adds, once that turn is drawn (scroll anchoring).
	const holdRef = useRef<{
		turnId: string;
		top: number;
		/** The turn the fill loads; holding starts once the list has it. */
		joining: TurnId;
		frames: number;
	} | null>(null);
	const [scroller, setScroller] = useState<HTMLElement | null>(null);
	// One callback for the list's life: a new one on each render would hand the scroller over again.
	const keepScroller = useCallback((element: HTMLElement | Window | null) => {
		setScroller(element instanceof HTMLElement ? element : null);
	}, []);
	const fillGap = (gap: ChatHistoryView["gaps"][number], side: GapSide) => {
		const joining = view === null ? null : gapTurnId(view, gap.beforeTurnId, side);
		const read = scroller === null ? null : topTurn(frameRef.current, scroller);
		holdRef.current = joining === null || read === null ? null : { ...read, joining, frames: 0 };
		setHolding(holdRef.current !== null);
		void actions.sessions.fillGap(sessionId, gap.beforeTurnId, side).then((result) => {
			if (result.ok) return;
			holdRef.current = null;
			setHolding(false);
		});
	};
	const turnsShown = view?.turns;
	useLayoutEffect(() => {
		const held = holdRef.current;
		// The list moves its turns once it has taken in the new one, so the hold starts then.
		if (held === null || turnsShown === undefined || !listCaughtUp) return;
		// Another change to the turns, such as a streamed reply, before the gap's turn arrived.
		if (!turnsShown.some((turn) => turn.turnId === held.joining)) return;
		let frames = 0;
		const release = () => {
			holdRef.current = null;
			setHolding(false);
		};
		// The list measures a new turn over a few frames; each one moves the list back by what the
		// held turn moved, until it stays put. A bound keeps a list that never settles from holding
		// forever.
		const settle = () => {
			const hold = holdRef.current;
			if (hold === null || scroller === null) return;
			const top = turnTop(frameRef.current, hold.turnId);
			if (top === null) {
				release();
				return;
			}
			const moved = top - hold.top;
			if (moved !== 0) scroller.scrollTop += moved;
			hold.frames = moved === 0 ? hold.frames + 1 : 0;
			frames += 1;
			if (hold.frames >= HOLD_STILL_FRAMES || frames > HOLD_LIMIT_FRAMES) {
				release();
				return;
			}
			requestAnimationFrame(settle);
		};
		settle();
	}, [turnsShown, scroller, listCaughtUp]);

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

	const firstItemIndex = useFirstItemIndex(sessionId, view);

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
								scrollerRef={keepScroller}
								data={data.turns}
								firstItemIndex={firstItemIndex}
								computeItemKey={(_, turn) => turn.turnId}
								itemContent={(_, turn) => {
									const gap = data.history.gaps.find((entry) => entry.beforeTurnId === turn.turnId);
									return (
										<>
											{gap === undefined ? null : (
												<GapMarker
													gap={gap}
													scroller={scroller}
													atBottom={atBottom}
													ready={caughtUp}
													onFill={(side) => fillGap(gap, side)}
												/>
											)}
											<TurnItem
												turn={turn}
												sessionId={sessionId}
												workspaceId={workspaceId}
												canRun={canRun}
												retry={turn === data.turns.at(-1) ? data.liveState.retry : undefined}
												expandAll={expandAll === true}
												agent={data.session.config.agent}
											/>
										</>
									);
								}}
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
								atTopStateChange={(top) => {
									setNearTop(top);
									listReported();
								}}
								totalListHeightChanged={(height) => {
									listReported();
									// The frame is the list's own height: the turns fill it once they are taller.
									const shown = frameRef.current?.clientHeight ?? 0;
									if (shown > 0 && height > shown) setRevealedFor(sessionId);
								}}
								rangeChanged={(range) => {
									// The list counts from `firstItemIndex`; `data.turns` from zero.
									const turn = data.turns[range.startIndex - firstItemIndex];
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
