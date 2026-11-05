/**
 * @feature CHAT-11 Interaction cards
 * Owns: the send, pending, failed and chosen state every interaction card shares.
 * Behaviour: packages/protocol/src/interactions.ts (InteractionAnswer), ui-map.md 3.3.
 * Our design choice: the card keeps its buttons usable after a failed answer and shows the
 * failure's own message. A failed answer is retried by pressing the same button again.
 * Must handle: a double click (one answer), an answer while the request is timed out (no answer),
 * and a failure whose message reaches the user.
 * Test first: two clicks on the same button call sessions.answer once, and a failed answer shows
 * the error's message.
 */
import type { InteractionAnswer } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { useCallback, useRef, useState } from "react";
import { useActions } from "../../../core/hooks.ts";

export interface InteractionAnswerOptions<A extends InteractionAnswer> {
	sessionId: SessionId;
	interactionId: InteractionId;
	/** The word shown once the agent has taken the answer, such as "Allowed". */
	labelFor: (answer: A) => string;
	/** True when the request takes no answer, such as a timed-out one. */
	blocked: boolean;
}

export interface InteractionAnswerControls<A extends InteractionAnswer> {
	answer: (value: A) => Promise<void>;
	/** The answer in flight, or null. */
	pending: A | null;
	/** The failure's message, or null. */
	failed: string | null;
	/** The label of the answer the agent took, or null. */
	chosen: string | null;
}

export function useInteractionAnswer<A extends InteractionAnswer>({
	sessionId,
	interactionId,
	labelFor,
	blocked,
}: InteractionAnswerOptions<A>): InteractionAnswerControls<A> {
	const actions = useActions();
	const busy = useRef(false);
	const [pending, setPending] = useState<A | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const [chosen, setChosen] = useState<string | null>(null);

	const answer = useCallback(
		async (value: A): Promise<void> => {
			if (busy.current || chosen !== null || blocked) return;
			busy.current = true;
			setPending(value);
			setFailed(null);
			const result = await actions.sessions.answer(sessionId, interactionId, value);
			if (!result.ok) {
				busy.current = false;
				setPending(null);
				setFailed(result.error.message);
				return;
			}
			setChosen(labelFor(value));
			setPending(null);
		},
		[actions, sessionId, interactionId, labelFor, chosen, blocked],
	);

	return { answer, pending, failed, chosen };
}
