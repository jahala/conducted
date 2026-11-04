/**
 * @feature SIDE-05 Event batching and live-state notifications
 * Owns: how a chat's LiveState changes (pure reducers) and the store that holds one LiveState per
 * chat and tells the app when it changes.
 * Behaviour: research/conductor/sessions.md section 2 "Status and state literals" (status is only
 * idle or working; everything else is a flag) and section 5 step 5 (live-state changes go to the
 * app as a separate notification). packages/protocol/src/live-state.ts defines the shape.
 * Must handle:
 *  - "idle" is published only after the turn's last event has been sent (the store takes a
 *    `flushed` promise from the event publisher before it publishes idle)
 *  - a new turn clears the previous error and the pending steers
 *  - a steer is pending from acceptance until the runner reports it consumed
 *  - an open interaction is cleared when it is answered or withdrawn
 *  - an unchanged state is not published again
 * Test first: beginTurn on a state with an error returns working with no error and no pending
 * steers.
 */
import { type Interaction, idleLiveState, type LiveState } from "@conducted/protocol";
import type { InteractionId, MessageId, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { SidecarToApp } from "../rpc/types.ts";

export type BackgroundTask = LiveState["backgroundTasks"][number];

export function beginTurn(state: LiveState): LiveState {
	const { error: _cleared, ...rest } = state;
	return { ...rest, status: "working", pendingSteerIds: [] };
}

export function endTurn(state: LiveState, error?: string): LiveState {
	const { error: _previous, openInteraction: _open, ...rest } = state;
	const next: LiveState = { ...rest, status: "idle", pendingSteerIds: [] };
	return error === undefined ? next : { ...next, error };
}

export function addPendingSteer(state: LiveState, id: MessageId): LiveState {
	if (state.pendingSteerIds.includes(id)) return state;
	return { ...state, pendingSteerIds: [...state.pendingSteerIds, id] };
}

export function removePendingSteer(state: LiveState, id: MessageId): LiveState {
	if (!state.pendingSteerIds.includes(id)) return state;
	return { ...state, pendingSteerIds: state.pendingSteerIds.filter((other) => other !== id) };
}

export function setBackgroundTasks(state: LiveState, tasks: BackgroundTask[]): LiveState {
	return { ...state, backgroundTasks: tasks };
}

export function openInteraction(
	state: LiveState,
	interactionId: InteractionId,
	interaction: Interaction,
	since: number,
): LiveState {
	return { ...state, openInteraction: { interactionId, interaction, since } };
}

export function closeInteraction(state: LiveState, interactionId: InteractionId): LiveState {
	if (state.openInteraction?.interactionId !== interactionId) return state;
	const { openInteraction: _closed, ...rest } = state;
	return rest;
}

export function markFastModeUnavailable(state: LiveState): LiveState {
	return state.fastModeAvailable ? { ...state, fastModeAvailable: false } : state;
}

/** Holds the LiveState of every chat and publishes changes. */
export class LiveStateStore {
	constructor(
		protected readonly deps: {
			app: SidecarToApp;
			/** Resolves when every event of the chat queued so far has been sent. */
			flushed(sessionId: SessionId): Promise<void>;
		},
	) {}

	get(_sessionId: SessionId): LiveState {
		return notImplemented("SIDE-05");
	}

	/** Applies a reducer and publishes the result when it differs. Idle waits for `flushed`. */
	update(_sessionId: SessionId, _reducer: (state: LiveState) => LiveState): Promise<void> {
		return notImplemented("SIDE-05");
	}

	/** Forgets a chat after resetAgent. */
	drop(_sessionId: SessionId): void {
		notImplemented("SIDE-05");
	}
}

export { idleLiveState };
