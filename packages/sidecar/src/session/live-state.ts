/**
 * @feature SIDE-05 Event batching and live-state notifications
 * Owns: how a chat's LiveState changes (pure reducers) and the store that holds one LiveState per
 * chat and tells the app when it changes.
 * Behaviour: research/conductor/sessions.md section 2 "Status and state literals" (status is only
 * idle or working; everything else is a flag) and section 5 step 5 (live-state changes go to the
 * app as a separate notification). packages/protocol/src/live-state.ts defines the shape.
 * Must handle:
 *  - a change is published only after the event publisher has flushed the chat's queued events,
 *    and "idle" is published only after the turn's last event has been sent
 *  - a new turn clears the previous error, the pending steers and any leftover wait
 *  - a steer is pending from acceptance until the runner reports it consumed
 *  - an open interaction is cleared when it is answered or withdrawn
 *  - a blocking task-output wait sets waitingSince, and it is cleared when the wait or turn ends
 *  - a failed event write is reported as the chat's error at once, because it leaves the
 *    publisher unable to flush the events that a normal live-state update waits behind
 *  - an unchanged state is not published again, and updates for one chat are published in order
 * Test first: beginTurn on a state with an error returns working with no error and no pending
 * steers.
 */
import { type Interaction, idleLiveState, type LiveState } from "@conducted/protocol";
import type { InteractionId, MessageId, SessionId } from "@conducted/shared";
import type { SidecarToApp } from "../rpc/types.ts";
import type { EventPublisher } from "./event-batcher.ts";
import { KeyedSerialQueue } from "./serial-queue.ts";

export type BackgroundTask = LiveState["backgroundTasks"][number];

function sameValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (left === null || right === null) return false;
	if (typeof left !== "object" || typeof right !== "object") return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	if (Array.isArray(left)) {
		if (!Array.isArray(right) || left.length !== right.length) return false;
		return left.every((item, index) => sameValue(item, right[index]));
	}
	const leftKeys = Object.keys(left).filter(
		(name) => (left as Record<string, unknown>)[name] !== undefined,
	);
	const rightKeys = Object.keys(right).filter(
		(name) => (right as Record<string, unknown>)[name] !== undefined,
	);
	if (leftKeys.length !== rightKeys.length) return false;
	return leftKeys.every(
		(name) =>
			Object.hasOwn(right, name) &&
			sameValue((left as Record<string, unknown>)[name], (right as Record<string, unknown>)[name]),
	);
}

function sameLiveState(left: LiveState, right: LiveState): boolean {
	return sameValue(left, right);
}

/** The live state's error after the user cancels the chat's work (sessions.md 2, SessionCancelledError). */
export const CANCELLED_BY_USER = "aborted by user";

export function beginTurn(state: LiveState): LiveState {
	const { error: _cleared, waitingSince: _waiting, retry: _retry, ...rest } = state;
	return { ...rest, status: "working", pendingSteerIds: [] };
}

export function endTurn(state: LiveState, error?: string): LiveState {
	const {
		error: _previous,
		openInteraction: _open,
		waitingSince: _waiting,
		retry: _retry,
		...rest
	} = state;
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
	if (sameValue(state.backgroundTasks, tasks)) return state;
	return { ...state, backgroundTasks: tasks };
}

/** Sets or clears the moment a blocking task-output wait began. */
export function setWaitingSince(state: LiveState, since?: number): LiveState {
	if (state.waitingSince === since) return state;
	const { waitingSince: _previous, ...rest } = state;
	return since === undefined ? rest : { ...rest, waitingSince: since };
}

/** Records a failure on the chat's live state without changing its status. */
export function setError(state: LiveState, error: string): LiveState {
	if (state.error === error) return state;
	return { ...state, error };
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
	private readonly bySession = new Map<SessionId, LiveState>();
	private readonly epochs = new Map<SessionId, number>();
	/** Updates of one chat run in call order. */
	private readonly chains = new KeyedSerialQueue();

	constructor(
		protected readonly deps: {
			app: SidecarToApp;
			/** Resolves when every event of the chat queued so far has been sent. */
			flushed(sessionId: SessionId): Promise<void>;
		},
	) {}

	get(sessionId: SessionId): LiveState {
		return this.bySession.get(sessionId) ?? idleLiveState;
	}

	/** Applies a reducer and publishes the result when it differs, after `flushed` resolves. */
	update(sessionId: SessionId, reducer: (state: LiveState) => LiveState): Promise<void> {
		const epoch = this.epochs.get(sessionId) ?? 0;
		return this.chains.run(sessionId, () => this.apply(sessionId, epoch, reducer));
	}

	/**
	 * Records an error and tells the app at once. A failed event write leaves the publisher's
	 * flush unresolved, so this path waits for neither the flush nor an earlier update that is
	 * blocked behind it: the user has to see why the chat stopped making progress.
	 */
	reportError(sessionId: SessionId, error: string): void {
		if (!this.bySession.has(sessionId)) return;
		const current = this.get(sessionId);
		const next = setError(current, error);
		if (sameLiveState(current, next)) return;
		this.bySession.set(sessionId, next);
		this.deps.app.notify("liveState", { sessionId, liveState: next });
	}

	/** Forgets a chat after resetAgent. */
	drop(sessionId: SessionId): void {
		this.bySession.delete(sessionId);
		this.epochs.set(sessionId, (this.epochs.get(sessionId) ?? 0) + 1);
	}

	private async apply(
		sessionId: SessionId,
		epoch: number,
		reducer: (state: LiveState) => LiveState,
	): Promise<void> {
		if ((this.epochs.get(sessionId) ?? 0) !== epoch) return;
		const current = this.get(sessionId);
		const next = reducer(current);
		if (sameLiveState(current, next)) return;
		this.bySession.set(sessionId, next);
		await this.deps.flushed(sessionId);
		if ((this.epochs.get(sessionId) ?? 0) !== epoch) {
			if (this.bySession.get(sessionId) === next) this.bySession.delete(sessionId);
			return;
		}
		this.deps.app.notify("liveState", { sessionId, liveState: this.get(sessionId) });
	}
}

/**
 * Connects the publisher's terminal write failures to the chat's live state. Without this the
 * publisher only logs and retries, and the chat never shows the error (sessions 5 step 4).
 */
export function reportWriteFailures(deps: {
	publisher: Pick<EventPublisher, "onWriteFailure">;
	liveState: LiveStateStore;
}): void {
	deps.publisher.onWriteFailure((sessionId, message) => {
		deps.liveState.reportError(sessionId, message);
	});
}

export { idleLiveState };
