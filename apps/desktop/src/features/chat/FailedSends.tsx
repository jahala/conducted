/**
 * @feature CHAT-06 Messages that were not sent
 * Owns: the "Message not sent" cards of a chat: the message the sidecar did not accept, with Retry and Discard.
 * Behaviour: ui-map.md 3.3 ('Message not sent' with Retry and Discard under the user message).
 * Our design choice: a message that failed has no turn in the list, because the pending turn is dropped when the
 * sidecar refuses it. The cards sit between the list and the composer, where the user looks next, and the card
 * reuses the user message bubble. The failed sends are read from the sessions store because ChatView carries
 * no failed sends yet; when it does, this reads them from the chat view.
 * Must handle: no failed send (nothing is drawn); Retry sends the same message again and keeps the card with the
 * new error when it fails again; Discard removes the card and puts the text back in the composer; a failed
 * Retry or Discard shows a toast; another chat's failed sends are never shown.
 * Test first: a failed send shows its text, the reason and Retry and Discard; Discard removes it.
 */
import type { MessageId, SessionId, TurnId } from "@conducted/shared";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import type { ChatTurn } from "../../core/model.ts";
import type { FailedSend } from "../../core/sessions.ts";
import { reportFailure } from "./report-failure.ts";
import { UserMessage } from "./UserMessage.tsx";

const NO_FAILED_SENDS: readonly FailedSend[] = [];

/** The failed sends of one chat, oldest first. */
function useFailedSends(sessionId: SessionId): readonly FailedSend[] {
	const { services } = useServices();
	return useStore(
		services.sessions.store,
		(state) => state.failedSends?.[sessionId] ?? NO_FAILED_SENDS,
	);
}

/** The one-message turn the user message bubble draws for a failed send. */
function turnOfFailedSend(failed: FailedSend): ChatTurn {
	return {
		turnId: failed.turnId as TurnId,
		startedBy: "user",
		userMessage: {
			messageId: failed.messageId as MessageId,
			text: failed.text,
			attachmentPaths: failed.attachmentPaths,
			at: failed.at,
			sender: null,
		},
		steers: [],
		blocks: [],
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "error",
		error: failed.error.message,
		startedAt: failed.at,
		endedAt: failed.at,
		usage: null,
		reverted: false,
	};
}

export function FailedSends({ sessionId }: { sessionId: SessionId }) {
	const failedSends = useFailedSends(sessionId);
	const actions = useActions();
	if (failedSends.length === 0) return null;

	return (
		<div data-region="failed-sends" className="flex flex-col gap-2">
			{failedSends.map((failed) => (
				<UserMessage
					key={failed.messageId}
					turn={turnOfFailedSend(failed)}
					sessionId={sessionId}
					failed={{ message: "Message not sent", error: failed.error.message }}
					onRetry={() => {
						void reportFailure(
							actions.sessions.retryFailedSend(sessionId, failed.messageId),
							"Couldn't send the message again",
						);
					}}
					onDiscard={() => {
						void reportFailure(
							actions.sessions.discardFailedSend(sessionId, failed.messageId),
							"Couldn't discard the message",
						);
					}}
				/>
			))}
		</div>
	);
}
