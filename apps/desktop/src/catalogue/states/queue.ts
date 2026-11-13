/**
 * @feature catalogue States of a working chat's follow-up queue and its stop
 * Owns: beacon's working chat with its queued follow-up opened for editing, the queue folded
 * away, the chat while its stop is still on its way to the agent, and the queue paused after the
 * stop; and the toasts of a queue change that fails: a delete, a steer, a retry, a resume and a
 * reorder, each refused by the database or the agent.
 * Behaviour: ui-map.md 3.4 (the queue box: "Queue paused" and Resume, Expand queue, Editing queued
 * message with Save edit and Save and steer), 3.8 ("Cancelling..."); services-map.md 2.3.3 (a
 * cancel pauses the queue and keeps its rows); inventory:toast rows for "Failed to delete queued
 * message", "Failed to steer queued message", "Failed to retry message", "Failed to resume queue"
 * and "Failed to reorder queued messages" (renderApp @9357302 to @9360437).
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { SessionEvent } from "@conducted/protocol";
import type { EventId, SessionId, TurnId } from "@conducted/shared";
import { animateCast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, clickOn, find, findFirst, shows } from "../dom.ts";
import { deliverEvents, setLiveState } from "../live.ts";
import { must } from "../seeds.ts";
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

/** True once a toast titled `title` is on screen. */
const toastShows =
	(title: string): Scene["ready"] =>
	(document) =>
		[...document.querySelectorAll("[data-sonner-toast]")].some((toast) =>
			toast.textContent?.includes(title),
		);

/** Steers the queued follow-up while the agent refuses every message, so the row fails. */
async function failSteer({ document, world }: AfterContext): Promise<void> {
	world.failSidecar("sendMessage");
	await click(document, `${QUEUE} button`, "Steer");
}

/**
 * Drags the first queued row below the last with real pointer events, as a user reorders the
 * queue: a press, moves past the drag threshold, and a release over the target row's lower half.
 */
async function dragFirstBelowLast(document: Document): Promise<void> {
	await findFirst(document, `${QUEUE} [role=option]:nth-of-type(3)`);
	const rows = [...document.querySelectorAll<HTMLElement>(`${QUEUE} [role=option]`)];
	const first = rows[0];
	const last = rows.at(-1);
	if (first === undefined || last === undefined) throw new Error("The queue has no rows to drag.");
	const from = first.getBoundingClientRect();
	const to = last.getBoundingClientRect();
	const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse" };
	const at = (x: number, y: number) => ({ ...init, clientX: x, clientY: y });
	const x = from.left + from.width / 2;
	first.dispatchEvent(new PointerEvent("pointerdown", at(x, from.top + from.height / 2)));
	document.dispatchEvent(new PointerEvent("pointermove", at(x, from.top + from.height / 2 + 12)));
	document.dispatchEvent(new PointerEvent("pointermove", at(x, to.bottom - 4)));
	document.dispatchEvent(new PointerEvent("pointerup", at(x, to.bottom - 4)));
}

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
	queueState(
		"chat-queue-delete-failed",
		"Working: deleting the queued follow-up fails",
		toastShows("Failed to delete queued message"),
		async ({ document, world }) => {
			await world.failWrites("queued_messages", "DELETE");
			await click(document, `${QUEUE} button`, "Delete");
		},
	),
	queueState(
		"chat-queue-steer-failed",
		"Working: steering with the queued follow-up fails, and the row offers Retry",
		toastShows("Failed to steer queued message"),
		failSteer,
	),
	queueState(
		"chat-queue-retry-failed",
		"Working: retrying the follow-up that failed to send fails too",
		toastShows("Failed to retry message"),
		async (context) => {
			await failSteer(context);
			// The row turns failed once the steer's own writes have landed; only then may they fail.
			const retry = await find(context.document, `${QUEUE} button`, "Retry");
			await context.world.failWrites("queued_messages", "UPDATE", ["state"]);
			clickOn(retry);
		},
	),
	queueState(
		"chat-queue-resume-failed",
		"Stopped with a follow-up queued: resuming the queue fails",
		toastShows("Failed to resume queue"),
		async ({ app, document, world }, beacon) => {
			const stopped = await app.container.actions.sessions.cancel(beacon.id);
			if (!stopped.ok) throw new Error(`Stopping beacon failed: ${stopped.error.message}`);
			deliverEvents(world, beacon.id, [STOPPED], 16);
			setLiveState(world, beacon.id, { status: "idle" });
			await world.failWrites("sessions", "UPDATE", ["queue_paused_at"]);
			await click(document, "button", "Resume");
		},
		(world) => world.answerSidecar({ cancel: () => ({ wasWorking: true, droppedMessageIds: [] }) }),
	),
	queueState(
		"chat-queue-reorder-failed",
		"Working with three follow-ups: moving one fails, and the order stays",
		toastShows("Failed to reorder queued messages"),
		async ({ app, document, world }, beacon) => {
			for (const text of ["Second queued message.", "Third queued message."]) {
				must(await app.container.actions.sessions.send(beacon.id, text, [], "queue"));
			}
			await world.failWrites("queued_messages", "UPDATE", ["position"]);
			await dragFirstBelowLast(document);
		},
	),
];
