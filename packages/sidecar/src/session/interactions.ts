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
import type {
	Interaction,
	InteractionAnswer,
	InteractionRequest,
	LiveState,
} from "@conducted/protocol";
import { CODEX_INTERACTION_TIMEOUT_MS } from "@conducted/protocol";
import type { Clock, IdSource, InteractionId, SessionId } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { SidecarToApp } from "../rpc/types.ts";
import { messageOf } from "../util/errors.ts";
import { closeInteraction, type LiveStateStore, openInteraction } from "./live-state.ts";

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

interface Waiting {
	request: InteractionRequest;
	readonly interaction: Interaction;
	readonly answer: (answer: InteractionAnswer) => void;
	settled: boolean;
}

interface SessionInteractions {
	active: Waiting | null;
	waiting: Waiting[];
}

export class SessionInteractionBroker implements InteractionBroker {
	private readonly sessions = new Map<SessionId, SessionInteractions>();
	private readonly liveUpdates = new Map<SessionId, Promise<void>>();

	constructor(
		protected readonly deps: {
			app: SidecarToApp;
			liveState: LiveStateStore;
			clock: Clock;
			ids: IdSource;
			logger: Logger;
		},
	) {}

	open(sessionId: SessionId, interaction: Interaction): Promise<InteractionAnswer> {
		let resolve!: (answer: InteractionAnswer) => void;
		const promise = new Promise<InteractionAnswer>((settle) => {
			resolve = settle;
		});
		const interactionId = this.deps.ids.uuid() as InteractionId;
		const entry: Waiting = {
			interaction,
			request: { sessionId, interactionId, interaction },
			answer: resolve,
			settled: false,
		};

		const session = this.sessionOf(sessionId);
		if (session.active === null) {
			this.activate(sessionId, session, entry);
		} else {
			session.waiting.push(entry);
		}
		return promise;
	}

	answer(
		sessionId: SessionId,
		interactionId: InteractionId,
		answer: InteractionAnswer,
	): { accepted: boolean; superseded: boolean } {
		const session = this.sessions.get(sessionId);
		const active = session?.active ?? null;
		if (active === null || active.request.interactionId !== interactionId) {
			return { accepted: false, superseded: true };
		}
		if (!answerMatches(active.interaction, answer)) {
			return { accepted: false, superseded: false };
		}
		this.settle(sessionId, active, answer);
		return { accepted: true, superseded: false };
	}

	withdrawAll(sessionId: SessionId): void {
		const session = this.sessions.get(sessionId);
		if (session === undefined) return;

		const entries =
			session.active === null ? session.waiting : [session.active, ...session.waiting];
		const active = session.active;
		session.active = null;
		session.waiting = [];
		this.sessions.delete(sessionId);

		if (active !== null) {
			this.publishLive(sessionId, (state) => closeInteraction(state, active.request.interactionId));
		}
		for (const entry of entries) {
			if (entry.settled) continue;
			entry.settled = true;
			entry.answer({ kind: "withdrawn" });
		}
	}

	openRequest(sessionId: SessionId): InteractionRequest | undefined {
		return this.sessions.get(sessionId)?.active?.request;
	}

	private sessionOf(sessionId: SessionId): SessionInteractions {
		let session = this.sessions.get(sessionId);
		if (session === undefined) {
			session = { active: null, waiting: [] };
			this.sessions.set(sessionId, session);
		}
		return session;
	}

	private activate(sessionId: SessionId, session: SessionInteractions, entry: Waiting): void {
		session.active = entry;
		if (needsExpiry(entry.interaction)) {
			entry.request = {
				...entry.request,
				expiresAt: this.deps.clock.now() + CODEX_INTERACTION_TIMEOUT_MS,
			};
		}
		this.publishLive(sessionId, (state) =>
			openInteraction(state, entry.request.interactionId, entry.interaction, this.deps.clock.now()),
		);
		void this.send(sessionId, entry);
	}

	private async send(sessionId: SessionId, entry: Waiting): Promise<void> {
		let answer: InteractionAnswer;
		try {
			const result = await this.deps.app.request("requestInteraction", entry.request);
			answer = result.ok ? result.value : unavailableAnswer(entry.interaction);
		} catch (cause) {
			this.deps.logger.warn("An interaction request failed", {
				sessionId,
				reason: messageOf(cause),
			});
			answer = unavailableAnswer(entry.interaction);
		}
		if (this.sessions.get(sessionId)?.active !== entry) return;
		this.settle(sessionId, entry, answer);
	}

	private settle(sessionId: SessionId, entry: Waiting, answer: InteractionAnswer): void {
		if (entry.settled) return;
		entry.settled = true;

		const session = this.sessions.get(sessionId);
		if (session?.active !== entry) {
			entry.answer(answer);
			return;
		}

		session.active = null;
		this.publishLive(sessionId, (state) => closeInteraction(state, entry.request.interactionId));
		const next = session.waiting.shift();
		if (next === undefined) {
			this.sessions.delete(sessionId);
		} else {
			this.activate(sessionId, session, next);
		}
		entry.answer(answer);
	}

	/** Applies a live-state change in call order, so an open never overtakes its close. */
	private publishLive(sessionId: SessionId, reducer: (state: LiveState) => LiveState): void {
		const previous = this.liveUpdates.get(sessionId) ?? Promise.resolve();
		const next = previous
			.then(() => this.deps.liveState.update(sessionId, reducer))
			.catch((cause: unknown) => {
				this.deps.logger.warn("Could not update the chat's live state for an interaction", {
					sessionId,
					reason: messageOf(cause),
				});
			});
		this.liveUpdates.set(sessionId, next);
		void next.then(() => {
			if (this.liveUpdates.get(sessionId) === next) this.liveUpdates.delete(sessionId);
		});
	}
}

/** Codex stops waiting for these on its own, so the request carries an expiry. */
function needsExpiry(interaction: Interaction): boolean {
	return interaction.kind === "permission_grant" || interaction.kind === "mcp_form";
}

/** What an agent gets when the app cannot answer: stop safely, never hang. */
function unavailableAnswer(interaction: Interaction): InteractionAnswer {
	switch (interaction.kind) {
		case "plan_approval":
			return {
				kind: "plan_approval",
				approved: false,
				feedback: "The app was not connected",
			};
		case "permission_grant":
			return { kind: "permission_grant", granted: false };
		case "mcp_form":
			return { kind: "mcp_form", action: "decline" };
		case "question":
		case "tool_approval":
			return { kind: "withdrawn" };
	}
}

/** Checks that an answer fits the interaction it claims to answer. */
export function answerMatches(interaction: Interaction, answer: InteractionAnswer): boolean {
	if (answer.kind === "withdrawn") return true;
	return answer.kind === interaction.kind;
}
