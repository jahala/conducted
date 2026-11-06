/**
 * @feature CHAT-06 Chat tab; CHAT-17 Chat search bar and copy transcript
 * Owns: the layout of one chat tab: the message list on top and, below it, the messages that were not sent,
 * the open interaction, the Codex goal bar (COMP-10), the progress line, the follow-up queue and the composer. It also loads the chat's
 * stored messages, records the chat on screen, clears the workspace's unread chats that do not wait for
 * the user, and hosts the find bar and the copy-transcript shortcut. It owns the message list's
 * scroll handle, so the find bar can bring a virtualised-out turn into view, and it keeps one find
 * bar across chat switches, so the query stays.
 * Behaviour: ui-map.md 3.3 (chat view), 3.2 ("[progress line] [queue] [composer]" under the list),
 * 3.4 (queue), 3.5 (composer), 4 (opening a workspace clears its unread chats).
 * Our design choice: every approval, question and plan review appears in one dock between the list and the
 * composer (see InteractionDock), so the user always looks at the same place for "the agent is waiting".
 * Each part is its own <NotBuiltYet>, keyed by session, so one failing part leaves the rest usable.
 * Must handle: switching chats (all parts reset, except the find bar, which keeps its query); the
 * composer is the only part that keeps focus; a narrow tab
 * (the list scrolls, the dock and composer never overflow); a pane that closes after a split pane recorded its
 * own chat (the other pane's chat stays recorded).
 * Test first: renders the list, progress, queue and composer regions for a session id.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Composer } from "../composer/Composer.tsx";
import { GoalBar } from "../composer/GoalBar.tsx";
import { QueueBox } from "../composer/QueueBox.tsx";
import { ChatSearchBar } from "./ChatSearchBar.tsx";
import { FailedSends } from "./FailedSends.tsx";
import { InteractionDock } from "./interactions/InteractionDock.tsx";
import { MessageList } from "./MessageList.tsx";
import { NextUnreadButton } from "./NextUnreadButton.tsx";
import { ProgressTracker } from "./ProgressTracker.tsx";

export function ChatPane({
	workspaceId,
	sessionId,
}: {
	workspaceId: WorkspaceId;
	sessionId: SessionId;
}) {
	const { services } = useServices();
	const actions = useActions();
	const [findOpen, setFindOpen] = useState(false);
	// The find bar scrolls the message list to a match in a turn the list has not mounted.
	const listRef = useRef<VirtuosoHandle>(null);

	useCommandHandler("chat.search", "area", () => {
		setFindOpen(true);
		return true;
	});
	useCommandHandler("chat.copyTranscript", "base", () => {
		void actions.sessions.copyTranscript(sessionId, "concise").then((result) => {
			if (!result.ok) toastError("Couldn't copy the transcript", result.error);
		});
		return true;
	});

	useEffect(() => {
		services.sessions.setViewing(sessionId);
		void services.sessions.markAllRead(workspaceId).then((result) => {
			if (!result.ok) toastError("Couldn't mark the workspace as read", result.error);
		});
		// A split pane shows another chat beside this one. Closing this pane must not clear the chat that
		// pane recorded since, or its new messages would count as unread while it is on screen.
		return () => {
			if (services.sessions.store.getState().viewingSessionId === sessionId) {
				services.sessions.setViewing(null);
			}
		};
	}, [services, sessionId, workspaceId]);

	// The chat's stored messages load when it is shown. Nothing else opens a chat.
	useEffect(() => {
		void services.sessions.open(sessionId).then((result) => {
			if (!result.ok) toastError("Couldn't load this chat's messages", result.error);
		});
	}, [services, sessionId]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-command-scope="chat-input"
				data-region="messages"
				className="relative min-h-0 flex-1"
			>
				<ChatSearchBar
					sessionId={sessionId}
					open={findOpen}
					onClose={() => setFindOpen(false)}
					onRevealTurn={(index) => listRef.current?.scrollToIndex({ index, align: "center" })}
				/>
				<div className="absolute right-3 top-2 z-10">
					<NextUnreadButton currentSessionId={sessionId} />
				</div>
				<NotBuiltYet area="Messages" resetKey={sessionId}>
					<MessageList sessionId={sessionId} workspaceId={workspaceId} listRef={listRef} />
				</NotBuiltYet>
			</div>
			<div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
				<NotBuiltYet area="Messages not sent" variant="inline" resetKey={sessionId}>
					<FailedSends sessionId={sessionId} />
				</NotBuiltYet>
				<div data-region="agent-request">
					<NotBuiltYet area="Agent request" variant="inline" resetKey={sessionId}>
						<InteractionDock sessionId={sessionId} />
					</NotBuiltYet>
				</div>
				<div data-region="goal">
					<NotBuiltYet area="Goal" variant="inline" resetKey={sessionId}>
						<GoalBar sessionId={sessionId} />
					</NotBuiltYet>
				</div>
				<div data-region="progress">
					<NotBuiltYet area="Progress" variant="inline" resetKey={sessionId}>
						<ProgressTracker sessionId={sessionId} />
					</NotBuiltYet>
				</div>
				<div data-region="queue">
					<NotBuiltYet area="Queue" variant="inline" resetKey={sessionId}>
						<QueueBox sessionId={sessionId} />
					</NotBuiltYet>
				</div>
				<div data-region="composer">
					<NotBuiltYet area="Composer" resetKey={sessionId}>
						<Composer workspaceId={workspaceId} sessionId={sessionId} />
					</NotBuiltYet>
				</div>
			</div>
		</div>
	);
}
