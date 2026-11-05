/**
 * @feature SIDE-11 Interactions: questions, approvals, permissions
 * Owns: the one stand-in for the interaction broker (InteractionBroker) that session tests use. It
 * records what a test opens and withdraws, and answers an opened interaction with a withdrawal
 * unless the test sets another answer.
 * Behaviour: session/interactions.ts. The real broker holds an interaction open until the user
 * answers or it is withdrawn; the fake answers at once, so a test that needs to wait uses
 * `holdOpen` and `answerOpen`.
 * Must handle: opened interactions recorded in order, withdrawAll calls recorded per chat, the
 * result of `answer` set by the test, and the open request a chat resends after a reconnect.
 * Test first: none. The real broker is tested in session/interactions.test.ts; this fake answers at
 * once and does not model the queue, so tests that need the queue use the real broker.
 */
import type { Interaction, InteractionAnswer, InteractionRequest } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import type { InteractionBroker } from "../session/interactions.ts";

export class FakeInteractions implements InteractionBroker {
	readonly withdrawn: SessionId[] = [];
	readonly opened: { sessionId: SessionId; interaction: Interaction }[] = [];
	readonly openRequests = new Map<SessionId, InteractionRequest>();
	readonly answered: {
		sessionId: SessionId;
		interactionId: InteractionId;
		answer: InteractionAnswer;
	}[] = [];
	answerResult = { accepted: true, superseded: false };
	/** When true, `open` waits for `answerOpen` instead of answering with a withdrawal. */
	holdOpen = false;
	private readonly waiting: ((answer: InteractionAnswer) => void)[] = [];

	open(sessionId: SessionId, interaction: Interaction): Promise<InteractionAnswer> {
		this.opened.push({ sessionId, interaction });
		if (!this.holdOpen) return Promise.resolve({ kind: "withdrawn" });
		return new Promise<InteractionAnswer>((resolve) => {
			this.waiting.push(resolve);
		});
	}

	/** Answers the oldest interaction that `open` is holding. */
	answerOpen(answer: InteractionAnswer): void {
		this.waiting.shift()?.(answer);
	}

	answer(
		sessionId: SessionId,
		interactionId: InteractionId,
		answer: InteractionAnswer,
	): { accepted: boolean; superseded: boolean } {
		this.answered.push({ sessionId, interactionId, answer });
		return this.answerResult;
	}

	withdrawAll(sessionId: SessionId): void {
		this.withdrawn.push(sessionId);
		for (const resolve of this.waiting.splice(0)) resolve({ kind: "withdrawn" });
	}

	openRequest(sessionId: SessionId): InteractionRequest | undefined {
		return this.openRequests.get(sessionId);
	}
}
