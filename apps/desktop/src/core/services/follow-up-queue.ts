/**
 * @feature CHAT-04 Follow-up queue and steering
 * Owns: messages typed while the agent works: queueing them, editing, reordering, deleting,
 * pausing, sending one now as a steer, and releasing the queue when the chat is idle.
 * Behaviour: sessions-and-chats.md "While the agent is working" (queue, steer, cancel),
 * sessions.md 6 (delivery modes, steer falls back to a normal follow-up), services-map.md 2.3.4
 * and 2.4.4 (local drainer: steer rows first, then the first queued row unless paused; rows stuck
 * in `sending` are settled after a crash), ui-map.md 3.4 (queue box, errors).
 * Must handle: steer rows go before queue rows; a paused queue releases nothing; only one row is
 * `sending` at a time per chat; a row that fails to send becomes `failed` with its error and
 * stays in place (the user retries or deletes it); an agent that cannot steer (ACP agents) gets
 * the message as a normal follow-up; a queued row is removed once its `user_message` event is
 * stored; the queue is only released when the chat is idle with no background tasks and no open
 * interaction; cancel drops nothing the user typed (cancel pauses the queue instead); edits to a
 * row that is already `sending` are refused; positions stay dense after a delete or reorder.
 * Our design choice: cancelling pauses the queue instead of deleting it, so typed follow-ups are
 * never lost. The user resumes with one click.
 * Test first: nextToSend returns the steer row before an earlier queue row.
 */
import type { LiveState, SessionConfig } from "@conducted/protocol";
import { type MessageId, notImplemented, type Result, type SessionId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Repositories } from "../db/repositories.ts";
import type { QueuedMessage } from "../model.ts";

export type SendMode = "auto" | "queue" | "steer";
export type SendDecision = "send_now" | "queue" | "steer";

/** ACP agents (OpenCode, Pi) cannot take a message in the middle of a turn. */
export const agentCanSteer = (config: Pick<SessionConfig, "agent">): boolean =>
	config.agent !== "acp";

/**
 * Decides what happens to a message the user sends. `auto` follows the user's default setting.
 * A steer for an agent that cannot steer becomes a queued follow-up.
 */
export function chooseDelivery(input: {
	mode: SendMode;
	working: boolean;
	defaultMode: "steer" | "queue";
	canSteer: boolean;
}): SendDecision {
	if (!input.working) return "send_now";
	const wanted = input.mode === "auto" ? input.defaultMode : input.mode;
	return wanted === "steer" && !input.canSteer ? "queue" : wanted;
}

/** True when nothing prevents the next queued message from being sent. */
export const canReleaseQueue = (liveState: LiveState): boolean =>
	liveState.status === "idle" &&
	liveState.backgroundTasks.length === 0 &&
	liveState.openInteraction === undefined;

/** The row to send next: steer rows first, then the first queue row, unless paused or busy. */
export function nextToSend(rows: readonly QueuedMessage[], paused: boolean): QueuedMessage | null {
	if (rows.some((row) => row.state === "sending")) return null;
	const ordered = [...rows].sort((a, b) => a.position - b.position);
	const steer = ordered.find((row) => row.delivery === "steer" && row.state === "waiting");
	if (steer !== undefined) return steer;
	if (paused) return null;
	return ordered.find((row) => row.delivery === "queue" && row.state === "waiting") ?? null;
}

export interface FollowUpQueueState {
	bySession: Readonly<Record<string, readonly QueuedMessage[]>>;
	pausedSessionIds: Readonly<Record<string, boolean>>;
}

export interface FollowUpQueueDeps {
	repos: Pick<Repositories, "queuedMessages" | "sessions">;
	/** Sends one row now (new turn or steer). Resolves when the sidecar accepted it. */
	deliver: (row: QueuedMessage) => Promise<Result<void>>;
	/** Undefined for a chat that is not loaded. */
	liveStateOf: (sessionId: SessionId) => LiveState | undefined;
}

export class FollowUpQueue {
	readonly store: StoreApi<FollowUpQueueState>;
	readonly #deps: FollowUpQueueDeps;

	constructor(deps: FollowUpQueueDeps) {
		this.#deps = deps;
		this.store = createStore<FollowUpQueueState>(() => ({ bySession: {}, pausedSessionIds: {} }));
	}

	load(_sessionId: SessionId): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("CHAT-04");
	}

	enqueue(_input: {
		sessionId: SessionId;
		text: string;
		attachmentPaths: readonly string[];
		delivery: "queue" | "steer";
	}): Promise<Result<QueuedMessage>> {
		return notImplemented("CHAT-04");
	}

	/** Backs `Actions.sessions.queue.edit`. */
	edit(_messageId: MessageId, _text: string): Promise<Result<void>> {
		return notImplemented("CHAT-04");
	}

	/** Backs `Actions.sessions.queue.remove`. */
	remove(_messageId: MessageId): Promise<Result<void>> {
		return notImplemented("CHAT-04");
	}

	/** Backs `Actions.sessions.queue.reorder`. */
	reorder(_sessionId: SessionId, _orderedIds: readonly MessageId[]): Promise<Result<void>> {
		return notImplemented("CHAT-04");
	}

	/** Backs `Actions.sessions.queue.setPaused`. */
	setPaused(_sessionId: SessionId, _paused: boolean): Promise<Result<void>> {
		return notImplemented("CHAT-04");
	}

	/** Backs `Actions.sessions.queue.sendNowAsSteer`. */
	sendNowAsSteer(_messageId: MessageId): Promise<Result<void>> {
		return notImplemented("CHAT-03");
	}

	/** Called when a chat goes idle or the user resumes the queue. Sends at most one row. */
	release(_sessionId: SessionId): Promise<Result<void>> {
		return notImplemented("CHAT-04");
	}

	/** Called by cancel: pauses the queue and keeps the rows. */
	pauseOnCancel(_sessionId: SessionId): Promise<Result<void>> {
		return notImplemented("CHAT-05");
	}
}
