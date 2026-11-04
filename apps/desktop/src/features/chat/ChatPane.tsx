/**
 * @feature CHAT-06 Chat tab
 * Owns: the layout of one chat tab: the message list on top and, below it, the open interaction, the progress
 * line, the follow-up queue and the composer.
 * Behaviour: ui-map.md 3.3 (chat view), 3.2 ("[progress line] [queue] [composer]" under the list),
 * 3.4 (queue), 3.5 (composer).
 * Our design choice: every approval, question and plan review appears in one dock between the list and the
 * composer (see InteractionDock), so the user always looks at the same place for "the agent is waiting".
 * Each part is its own <NotBuiltYet>, keyed by session, so one failing part leaves the rest usable.
 * Must handle: switching chats (all parts reset); the composer is the only part that keeps focus; a narrow tab
 * (the list scrolls, the dock and composer never overflow).
 * Test first: renders the list, progress, queue and composer regions for a session id.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { Composer } from "../composer/Composer.tsx";
import { QueueBox } from "../composer/QueueBox.tsx";
import { InteractionDock } from "./interactions/InteractionDock.tsx";
import { MessageList } from "./MessageList.tsx";
import { ProgressTracker } from "./ProgressTracker.tsx";

export function ChatPane({
	workspaceId,
	sessionId,
}: {
	workspaceId: WorkspaceId;
	sessionId: SessionId;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1">
				<NotBuiltYet area="Messages" resetKey={sessionId}>
					<MessageList sessionId={sessionId} workspaceId={workspaceId} />
				</NotBuiltYet>
			</div>
			<div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
				<NotBuiltYet area="Agent request" variant="inline" resetKey={sessionId}>
					<InteractionDock sessionId={sessionId} />
				</NotBuiltYet>
				<NotBuiltYet area="Progress" variant="inline" resetKey={sessionId}>
					<ProgressTracker sessionId={sessionId} />
				</NotBuiltYet>
				<NotBuiltYet area="Queue" variant="inline" resetKey={sessionId}>
					<QueueBox sessionId={sessionId} />
				</NotBuiltYet>
				<NotBuiltYet area="Composer" resetKey={sessionId}>
					<Composer workspaceId={workspaceId} sessionId={sessionId} />
				</NotBuiltYet>
			</div>
		</div>
	);
}
