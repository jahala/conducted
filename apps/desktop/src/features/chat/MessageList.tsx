/**
 * @feature CHAT-06 Message list; CHAT-27 Visible auto-retry with Retry now; CHAT-25 Turn outline
 * Owns: The virtualised list of turns in a chat, with a header for older history, a footer for the
 * live state, the running turn's retry line, the scroll-to-bottom behaviour, and the turn outline
 * beside the list.
 * Behaviour: frontend.md 5 (one virtualised item per turn, keyed by turn id; Header for history
 * loading; Footer; a 'Scroll to bottom' button over the list; increaseViewportBy 600), ui-map.md
 * 3.3 (list; 'Something went wrong, retrying n/m' with Retry now on the running turn).
 * Our design choice: Built on react-virtuoso's Virtuoso (MIT) instead of the commercial
 * VirtuosoMessageList. Use data + computeItemKey (turn id), increaseViewportBy, followOutput
 * (follow only while the user is at the bottom, via atBottomStateChange), components.Header and
 * components.Footer, and a ref to scrollToIndex, which the chat pane may own so its find bar can
 * scroll to a turn the list has not mounted. Only the newest turn changes while streaming:
 * TurnItem is memoised on the turn object, and the service (CHAT-07) keeps unchanged turns
 * referentially equal.
 * The list opens at its end (the last turn's footer in view, as Conductor does), and its footer holds the
 * working line while the agent works.
 * Must handle: Loading (skeleton turns); an error card and the running turn's retry line (their
 * actions live in TurnItem and ChatBanner); empty chat (EmptyChat with starters, or none in an
 * archived workspace; the composer bar says the workspace is read-only); a turn added while the
 * user reads old messages (no jump, show Scroll to bottom);
 * the chat switches (list resets to the bottom); a very long turn; each turn in its own boundary
 * 'This chat turn failed to render. Other turns are still available.'; 2000 turns stay smooth (tested at that size).
 * Test first: With 2000 turns only a small window of TurnItem is mounted; appending a block to the
 * last turn re-renders only that item.
 */
import type { LiveState } from "@conducted/protocol";
import type { SessionId, TurnId, WorkspaceId } from "@conducted/shared";
import { type RefObject, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useActions, useChat, useDraft, useSetting, useWorkspace } from "../../core/hooks.ts";
import type { ChatView } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
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

function LoadingTurns() {
	return (
		<div className="flex flex-col gap-4 p-7">
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

function HistoryHeader() {
	return <div data-region="history-header" className="h-3" aria-hidden="true" />;
}

interface ListContext {
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
						<Virtuoso
							key={sessionId}
							ref={listRef}
							data={data.turns}
							computeItemKey={(_, turn) => turn.turnId}
							itemContent={(index, turn) => (
								<TurnItem
									turn={turn}
									sessionId={sessionId}
									workspaceId={workspaceId}
									canRun={canRun}
									retry={index === data.turns.length - 1 ? data.liveState.retry : undefined}
									expandAll={expandAll === true}
								/>
							)}
							context={{ working: workingOf(data) }}
							initialTopMostItemIndex={{ index: "LAST", align: "end" }}
							increaseViewportBy={600}
							followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
							atBottomStateChange={setAtBottom}
							rangeChanged={(range) => {
								const turn = data.turns[range.startIndex];
								if (turn === undefined) return;
								setCurrentTurnId((previous) => (previous === turn.turnId ? previous : turn.turnId));
							}}
							components={{ Header: HistoryHeader, Footer: ListFooter }}
							className="h-full"
						/>
						<div className="absolute right-2 top-1/2 z-10 -translate-y-1/2">
							<TurnOutline
								turns={data.turns}
								currentTurnId={currentTurnId}
								onJumpToTurn={(turnId) => {
									const index = data.turns.findIndex((turn) => turn.turnId === turnId);
									if (index < 0) return;
									listRef.current?.scrollToIndex({ index, align: "start" });
								}}
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
				)
			}
		</LoadableView>
	);
}
