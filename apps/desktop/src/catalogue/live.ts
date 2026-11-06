/**
 * @feature catalogue What the scripted sidecar tells the app while a state runs
 * Owns: delivering a chat's live state, its events and the interactions an agent opens, as the sidecar's
 * notifications and requests (packages/protocol/src/rpc.ts, "sidecar -> UI").
 * Behaviour: the app's own handlers (core/sidecar/handlers.ts) and event ingest (core/sidecar/ingest.ts)
 * take these lines exactly as they take the real sidecar's.
 * Must handle: events of a turn that is still running are delivered after the app starts, because
 * startup repair closes a stored turn with no end as interrupted (core/db/repair.ts).
 * Test first: not applicable; the screenshot run opens every state that uses it.
 */
import {
	type Interaction,
	idleLiveState,
	type LiveState,
	type SessionEvent,
} from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import type { World } from "./world.ts";

/** Tells the app a chat's live state: working unless `patch` says otherwise. */
export function setLiveState(world: World, sessionId: SessionId, patch: Partial<LiveState>): void {
	const liveState: LiveState = { ...idleLiveState, status: "working", ...patch };
	world.notify("liveState", { sessionId, liveState });
}

/** Delivers events in order, numbered from `firstSequence`. */
export function deliverEvents(
	world: World,
	sessionId: SessionId,
	events: readonly SessionEvent[],
	firstSequence = 1,
): void {
	events.forEach((event, index) => {
		world.notify("sessionEvent", { sessionId, sequence: firstSequence + index, event });
	});
}

/** The agent asks the user: the request the card answers, and the working state that shows it. */
export function openInteraction(
	world: World,
	sessionId: SessionId,
	interactionId: string,
	interaction: Interaction,
): void {
	const id = interactionId as InteractionId;
	world.request("requestInteraction", { sessionId, interactionId: id, interaction });
	setLiveState(world, sessionId, {
		openInteraction: { interactionId: id, interaction, since: world.clock.now() },
	});
}
