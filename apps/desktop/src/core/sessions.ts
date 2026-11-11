/**
 * @feature CHAT-01 Create, close, rename chats; chat history
 * @feature CHAT-02 Send a message as a new turn
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: the shape of a failed send, the messages for a goal that cannot be set, the rule for
 * whether a chat is blocked on the user, and the rule for whether its agent is still working. The
 * sessions service and the tab strip import them.
 * Behaviour: services-map.md 5B.4 (failures, goals), ui-map.md 3.5 (goal bar).
 */
import type { LiveState } from "@conducted/protocol";
import type { AppError, MessageId, SessionId, TurnId } from "@conducted/shared";

/** A message the user sent that the sidecar did not accept. The chat offers Retry and Discard. */
export interface FailedSend {
	messageId: MessageId;
	turnId: TurnId;
	text: string;
	attachmentPaths: string[];
	at: number;
	delivery: "new_turn" | "steer";
	error: AppError;
}

/**
 * Conductor's messages for a goal it cannot set (ui-map.md 3.5, the toast inventory). The goal
 * bar and the `/goal` slash command show the same words.
 */
export const GOAL_UNAVAILABLE = "Codex goals are not available in this chat.";
export const GOAL_EMPTY = "Enter a goal first.";

/**
 * True when a chat is blocked on the user right now: it has a card the user must answer, either in
 * the app's own map or in the live state the sidecar sent.
 */
export function sessionWaitsForUser(
	state: {
		openInteractions: Readonly<Record<string, unknown>>;
		liveStates: Readonly<Record<string, { openInteraction?: unknown }>>;
	},
	sessionId: SessionId,
): boolean {
	return (
		state.openInteractions[sessionId] !== undefined ||
		state.liveStates[sessionId]?.openInteraction !== undefined
	);
}

/**
 * True while a chat's agent is still working: the sidecar says working, or a cancel was asked and
 * has not been answered yet. Closing a chat in this state asks first (services-map 5B, ui-map 3.2).
 */
export function chatIsWorking(
	state: {
		cancelling: Readonly<Record<string, boolean>>;
		liveStates: Readonly<Record<string, LiveState>>;
	},
	sessionId: SessionId,
): boolean {
	return state.cancelling[sessionId] === true || state.liveStates[sessionId]?.status === "working";
}
