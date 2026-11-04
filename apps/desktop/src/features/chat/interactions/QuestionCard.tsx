/**
 * @feature CHAT-10 Question card
 * Owns: The wizard that shows the agent's questions one page at a time and sends the answers back.
 * Behaviour: ui-map.md 3.3 (Question UI: one page per question; header, question, option list with
 * descriptions, multi-select, 'Other...' free text (0), previous and next (arrow keys), number keys
 * 1..9 pick options, Enter submits, buttons Submit and 'Cancel agent'; answers return as 'question
 * / answer / (Skipped)'), claude-runner.md 3.4.
 * Our design choice: The secret-input option from Conductor is not in our protocol and is left out.
 * The sidebar status reads 'Answer question' while this is open.
 * Must handle: One question (no previous or next); up to four questions; a multi-select question
 * with nothing ticked (skipped, allowed); 'Other' text empty (not accepted); the interaction is
 * withdrawn while open (card disappears, typed text is lost on purpose); answering sends
 * sessions.answer once and disables the card while it runs; Cancel agent calls sessions.cancel.
 * Test first: Choosing option 2 on a single-select question and pressing Enter calls
 * sessions.answer with answers [['<label 2>']].
 */

import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface QuestionCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	questions: Extract<Interaction, { kind: "question" }>["questions"];
}

export function QuestionCard(_props: QuestionCardProps): never {
	return notImplemented("CHAT-10");
}
