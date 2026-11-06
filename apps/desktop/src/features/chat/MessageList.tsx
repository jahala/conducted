/**
 * @feature CHAT-06 Message list; CHAT-27 Visible auto-retry with Retry now
 * Owns: The virtualised list of turns in a chat, with a header for older history, a footer for the
 * live state, the running turn's retry line, and the scroll-to-bottom behaviour.
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
 * Must handle: Loading (skeleton turns); an error card and the running turn's retry line (their
 * actions live in TurnItem and ChatBanner); empty chat (EmptyChat with starters, or none in an
 * archived workspace; the composer bar says the workspace is read-only); a turn added while the
 * user reads old messages (no jump, show Scroll to bottom);
 * the chat switches (list resets to the bottom); a very long turn; each turn in its own boundary
 * 'This chat turn failed to render. Other turns are still available.'; 2000 turns stay smooth (tested at that size).
 * Test first: With 2000 turns only a small window of TurnItem is mounted; appending a block to the
 * last turn re-renders only that item.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { type RefObject, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useActions, useChat, useDraft, useSetting, useWorkspace } from "../../core/hooks.ts";
import type { ChatView } from "../../core/model.ts";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { EmptyChat } from "./EmptyChat.tsx";
import { reportFailure } from "./report-failure.ts";
import { ScrollToBottomButton } from "./ScrollToBottomButton.tsx";
import { TurnItem } from "./TurnItem.tsx";

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

function ListFooter() {
	return <div data-region="list-footer" className="h-3" aria-hidden="true" />;
}

export function MessageList({ sessionId, workspaceId, listRef: parentListRef }: MessageListProps) {
	const chat = useChat(sessionId);
	const workspace = useWorkspace(workspaceId);
	const archived = workspace.state === "ready" && workspace.data.state === "archived";
	const canRun = workspace.state === "ready" && workspace.data.state === "ready";
	const draft = useDraft(sessionId);
	const actions = useActions();
	const expandAll = useSetting<boolean>("expand_tool_calls");
	const ownListRef = useRef<VirtuosoHandle>(null);
	const listRef = parentListRef ?? ownListRef;
	const [atBottom, setAtBottom] = useState(true);

	useCommandHandler("chat.expandAllToolCalls", "area", () => {
		void reportFailure(
			actions.settings.set("expand_tool_calls", !expandAll),
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
			errorTitle="Couldn't load this chat"
		>
			{(data: ChatView) =>
				data.turns.length === 0 ? (
					<EmptyChat onPick={pickStarter} archived={archived} />
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
								/>
							)}
							initialTopMostItemIndex={Math.max(0, data.turns.length - 1)}
							increaseViewportBy={600}
							followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
							atBottomStateChange={setAtBottom}
							components={{ Header: HistoryHeader, Footer: ListFooter }}
							className="h-full"
						/>
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
