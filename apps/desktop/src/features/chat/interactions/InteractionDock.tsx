/**
 * @feature CHAT-10 Interaction dock
 * Owns: reading the chat's open interaction and showing the matching card above the composer.
 * Behaviour: claude-runner.md 3 (questions, approvals and plans), ui-map.md 3.3 (sidebar status text "Answer
 * question", "Need permission", "Review plan").
 * Must handle: no open interaction (renders nothing); the interaction is withdrawn while shown (the card
 * disappears, no stale buttons); loading and error of the chat (the message list shows them, the dock stays
 * empty); only one interaction is open per session.
 * Test first: a ready chat with an open question renders the question card; with none it renders nothing.
 */
import type { SessionId } from "@conducted/shared";
import { useChat } from "../../../core/hooks.ts";
import { InteractionHost } from "./InteractionHost.tsx";

export function InteractionDock({ sessionId }: { sessionId: SessionId }) {
	const chat = useChat(sessionId);
	if (chat.state !== "ready" || chat.data.openInteraction === null) return null;
	const { interactionId, interaction, expiresAt, timedOut } = chat.data.openInteraction;
	return (
		<InteractionHost
			key={interactionId}
			sessionId={sessionId}
			interactionId={interactionId}
			interaction={interaction}
			expiresAt={expiresAt}
			timedOut={timedOut}
		/>
	);
}
