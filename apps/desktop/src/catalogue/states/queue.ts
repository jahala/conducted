/**
 * @feature catalogue States of a working chat's follow-up queue and its stop
 * Owns: beacon's working chat with its queued follow-up opened for editing, the queue folded
 * away, the chat while its stop is still on its way to the agent, and the queue paused after the
 * stop.
 * Behaviour: ui-map.md 3.4 (the queue box: "Queue paused" and Resume, Expand queue, Editing queued
 * message with Save edit and Save and steer), 3.8 ("Cancelling..."); services-map.md 2.3.3 (a
 * cancel pauses the queue and keeps its rows).
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { SessionEvent } from "@conducted/protocol";
import type { EventId, SessionId, TurnId } from "@conducted/shared";
import { animateCast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, shows } from "../dom.ts";
import { deliverEvents, setLiveState } from "../live.ts";
import type { AfterContext, CatalogueState, Scene } from "../state.ts";
import { CATALOGUE_NOW } from "../time.ts";
import type { World } from "../world.ts";

const QUEUE = '[role=listbox][aria-label="Queued messages"]';

/** beacon's working chat with its queued follow-up, then `then`. */
const queueState = (
	id: string,
	title: string,
	ready: Scene["ready"],
	then: (context: AfterContext, beacon: { id: SessionId }) => Promise<void>,
	before?: (world: World) => void,
): CatalogueState => ({
	id,
	group: "Workspace chat",
	title,
	seed: async (world) => {
		const cast = await seedCast(world);
		before?.(world);
		return {
			route: chatRoute(cast.beacon, cast.chats.beacon),
			after: async (context) => {
				await animateCast(world, cast, context.app);
				await refreshGit(context.app, cast.beacon);
				await then(context, cast.chats.beacon);
			},
			ready,
		};
	},
});

/** The end of beacon's running turn once the agent has stopped it. */
const STOPPED: SessionEvent = {
	type: "turn_ended",
	eventId: "beacon-live-stopped" as EventId,
	at: CATALOGUE_NOW,
	turnId: "beacon-live-t1" as TurnId,
	outcome: "cancelled",
};

export const QUEUE_STATES: CatalogueState[] = [
	queueState(
		"chat-queue-editing",
		"Working, the queued follow-up opened for editing",
		(document) => shows(document, "Editing queued message"),
		({ document }) => click(document, `${QUEUE} button`, "Edit"),
	),
	queueState(
		"chat-queue-collapsed",
		"Working, the follow-up queue folded away",
		(document) => document.querySelector('button[aria-label="Expand queue"]') !== null,
		({ document }) => click(document, "button", "Collapse queue"),
	),
	queueState(
		"chat-cancelling",
		"Working, the stop on its way to the agent",
		(document) => document.querySelector('[aria-label="Cancelling…"]') !== null,
		async ({ app }, beacon) => {
			void app.container.actions.sessions.cancel(beacon.id);
		},
		(world) => world.holdSidecar("cancel"),
	),
	queueState(
		"chat-queue-paused",
		"Stopped with a follow-up queued: the queue waits until it is resumed",
		(document) => shows(document, "Queue paused"),
		async ({ app, world }, beacon) => {
			const stopped = await app.container.actions.sessions.cancel(beacon.id);
			if (!stopped.ok) throw new Error(`Stopping beacon failed: ${stopped.error.message}`);
			deliverEvents(world, beacon.id, [STOPPED], 16);
			setLiveState(world, beacon.id, { status: "idle" });
		},
		(world) => world.answerSidecar({ cancel: () => ({ wasWorking: true, droppedMessageIds: [] }) }),
	),
];
