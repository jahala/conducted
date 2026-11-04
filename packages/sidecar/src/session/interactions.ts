/**
 * @feature SIDE-11 Interactions
 * Owns: the moments where an agent waits for the user. At most one is open per chat. The broker
 * sends it to the app as a requestInteraction request, publishes it in the chat's live state, and
 * resolves the agent's promise with the answer.
 * Behaviour: research/conductor/sessions-and-chats.md "Questions, approvals and plans",
 * claude-runner.md sections 3.4 and 3.5, other-runners.md section 4 ("a per-session manager holds
 * one active user interaction at a time"). Locally there is no timeout.
 * Must handle:
 *  - a second request while one is open: it waits its turn and opens when the first closes
 *  - withdrawAll() on cancel, on a new non-steering message, on a steer, on resetAgent and on
 *    shutdown: every open or waiting interaction resolves with { kind: "withdrawn" }
 *  - the app answers an interaction that was already withdrawn: answer() returns
 *    { accepted: false, superseded: true }
 *  - an answer whose kind does not match the interaction: refused, the interaction stays open
 *  - the app is disconnected or the request fails: a plan resolves as rejected with the feedback
 *    "The app was not connected", a question or approval resolves as withdrawn, and a Codex
 *    permission or MCP form resolves as declined. Conductor does the same for the first two
 *  - reconnect: an interaction that is still open is sent again on attach, because the app may
 *    have lost it
 *  - the live state shows the open interaction and clears it when the answer arrives
 * Test first: open A, open B, answer A; B opens next, and answering A again returns superseded.
 */
import type { Interaction, InteractionAnswer, InteractionRequest } from "@conducted/protocol";
import type { Clock, IdSource, InteractionId, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { SidecarToApp } from "../rpc/types.ts";
import type { LiveStateStore } from "./live-state.ts";

export interface InteractionBroker {
	/** Opens an interaction and resolves with the user's answer, or "withdrawn". */
	open(sessionId: SessionId, interaction: Interaction): Promise<InteractionAnswer>;
	/** Called for answerInteraction requests from the app. */
	answer(
		sessionId: SessionId,
		interactionId: InteractionId,
		answer: InteractionAnswer,
	): { accepted: boolean; superseded: boolean };
	/** Resolves every open and waiting interaction of the chat as withdrawn. */
	withdrawAll(sessionId: SessionId): void;
	/** The request to resend for a chat after a reconnect, if one is open. */
	openRequest(sessionId: SessionId): InteractionRequest | undefined;
}

export class SessionInteractionBroker implements InteractionBroker {
	constructor(
		protected readonly deps: {
			app: SidecarToApp;
			liveState: LiveStateStore;
			clock: Clock;
			ids: IdSource;
			logger: Logger;
		},
	) {}

	open(_sessionId: SessionId, _interaction: Interaction): Promise<InteractionAnswer> {
		return notImplemented("SIDE-11");
	}

	answer(
		_sessionId: SessionId,
		_interactionId: InteractionId,
		_answer: InteractionAnswer,
	): { accepted: boolean; superseded: boolean } {
		return notImplemented("SIDE-11");
	}

	withdrawAll(_sessionId: SessionId): void {
		notImplemented("SIDE-11");
	}

	openRequest(_sessionId: SessionId): InteractionRequest | undefined {
		return notImplemented("SIDE-11");
	}
}

/** Checks that an answer fits the interaction it claims to answer. */
export function answerMatches(interaction: Interaction, answer: InteractionAnswer): boolean {
	if (answer.kind === "withdrawn") return true;
	return answer.kind === interaction.kind;
}
