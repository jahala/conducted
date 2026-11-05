/**
 * @feature CHAT-06 Chat tab
 * Owns: the layout of one chat tab: the message list on top and, below it, the messages that were not sent,
 * the open interaction, the progress line, the follow-up queue and the composer. It also loads the chat's
 * stored messages, records the chat on screen and clears the workspace's unread chats that do not wait for
 * the user.
 * Behaviour: ui-map.md 3.3 (chat view), 3.2 ("[progress line] [queue] [composer]" under the list),
 * 3.4 (queue), 3.5 (composer), 4 (opening a workspace clears its unread chats).
 * Our design choice: every approval, question and plan review appears in one dock between the list and the
 * composer (see InteractionDock), so the user always looks at the same place for "the agent is waiting".
 * Each part is its own <NotBuiltYet>, keyed by session, so one failing part leaves the rest usable.
 * Must handle: switching chats (all parts reset); the composer is the only part that keeps focus; a narrow tab
 * (the list scrolls, the dock and composer never overflow).
 * Test first: renders the list, progress, queue and composer regions for a session id.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { useEffect } from "react";
import { useServices } from "../../core/context.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Composer } from "../composer/Composer.tsx";
import { QueueBox } from "../composer/QueueBox.tsx";
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

	useEffect(() => {
		services.sessions.setViewing(sessionId);
		void services.sessions.markAllRead(workspaceId).then((result) => {
			if (!result.ok) toastError("Couldn't mark the workspace as read", result.error);
		});
		return () => services.sessions.setViewing(null);
	}, [services, sessionId, workspaceId]);

	// The chat's stored messages load when it is shown. Nothing else opens a chat.
	useEffect(() => {
		void services.sessions.open(sessionId).then((result) => {
			if (!result.ok) toastError("Couldn't load this chat's messages", result.error);
		});
	}, [services, sessionId]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div data-region="messages" className="relative min-h-0 flex-1">
				<div className="absolute right-3 top-2 z-10">
					<NextUnreadButton currentSessionId={sessionId} />
				</div>
				<NotBuiltYet area="Messages" resetKey={sessionId}>
					<MessageList sessionId={sessionId} workspaceId={workspaceId} />
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
