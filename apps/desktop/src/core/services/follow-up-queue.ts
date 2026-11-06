/**
 * @feature CHAT-04 Follow-up queue and steering
 * Owns now: the rules for choosing a delivery (`chooseDelivery`), for releasing the queue
 * (`canReleaseQueue`) and for picking the next row (`nextToSend`); the persistent queue itself
 * (`load`, `enqueue`, `edit`, `remove`, `reorder`, `setPaused`, `retry` and `release`); and
 * `sendNowAsSteer` and `pauseOnCancel`.
 * Behaviour: sessions-and-chats.md "While the agent is working" (queue, steer, cancel),
 * sessions.md 6 (delivery modes, steer falls back to a normal follow-up), services-map.md 2.3.3,
 * 2.3.4 and 2.4.4 (local drainer: steer rows first, then the first queued row unless paused), ui-map.md 3.4.
 * Must handle: steer rows go before queue rows; a paused queue releases no queue row; nothing is
 * picked while a row is `sending`; failed rows are skipped and the next one is tried; a message
 * that fails to send becomes `failed` with its error; a stale load never overwrites a newer one;
 * a follow-up queued before the chat's rows were read reads them all, so stored rows stay ahead;
 * an agent that cannot steer (ACP agents) gets a message sent with the default mode as a normal
 * follow-up, while an explicit steer (a send with steer delivery, or send-now-as-steer) fails
 * visibly and a queued row stays queued (other-runners.md 2.4); a row is delivered under its own
 * id, so startup repair finds its stored user message and never sends it twice; the queue is
 * released only when the chat is idle with no background tasks and no open interaction; after a
 * failed turn the queue is paused so nothing fires into a broken chat; cancel pauses the queue
 * instead of dropping what the user typed, and moves a row that was already `sending` to the end
 * as waiting again (CHAT-05); a chat whose agent program is still being made ready (`isHeld`,
 * PLAT-28) keeps its rows until the composition root releases them again.
 * Our design choice: cancelling pauses the queue instead of deleting it, so typed follow-ups are
 * never lost. The pause flag is written to `sessions.queue_paused_at` by `setPaused`.
 * Test first: nextToSend returns the steer row before an earlier queue row; loading twice keeps
 * only the newest answer; a failed send marks its row failed and the next row is tried.
 */
import type { LiveState, SessionConfig } from "@conducted/protocol";
import {
	type AppError,
	appError,
	err,
	type MessageId,
	ok,
	type Result,
	type SessionId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createLatestWins } from "../async/latest-wins.ts";
import type { Repositories } from "../db/repositories.ts";
import type { QueuedMessage } from "../model.ts";

export type SendMode = "auto" | "queue" | "steer";
/** `steer_unsupported`: the user asked to steer an agent that cannot take a steer. */
export type SendDecision = "send_now" | "queue" | "steer" | "steer_unsupported";

/** ACP agents (OpenCode, Pi) cannot take a message in the middle of a turn. */
export const agentCanSteer = (config: Pick<SessionConfig, "agent">): boolean =>
	config.agent !== "acp";

/**
 * Decides what happens to a message the user sends. `auto` follows the user's default setting,
 * and a default of steer becomes a queued follow-up for an agent that cannot steer. A steer the
 * user asked for by name is refused for such an agent, so it fails visibly instead of quietly
 * turning into a follow-up (other-runners.md 2.4).
 */
export function chooseDelivery(input: {
	mode: SendMode;
	working: boolean;
	defaultMode: "steer" | "queue";
	canSteer: boolean;
}): SendDecision {
	if (!input.working) return "send_now";
	if (input.mode === "steer" && !input.canSteer) return "steer_unsupported";
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
	/**
	 * Sends one row now (new turn or steer), with the row's id as the message id, so the stored
	 * user message matches the row. Resolves when the sidecar accepted it.
	 */
	deliver: (row: QueuedMessage) => Promise<Result<void>>;
	/** Undefined for a chat that is not loaded. */
	liveStateOf: (sessionId: SessionId) => LiveState | undefined;
	/** A fresh id for a queued message. */
	newId: () => string;
	/** The time written when a queue is paused. */
	now: () => number;
	/** Reports a send or pause that failed while nobody waits for it. */
	log?: (level: "warn" | "info", message: string) => void;
	/**
	 * True while the chat's agent program is still being made ready (PLAT-28): its rows wait. The
	 * composition root calls `release` again when the program's state changes.
	 */
	isHeld?: (sessionId: SessionId) => boolean;
}

const unknownMessage = (): AppError =>
	appError("queue_unknown", "That queued message no longer exists.");

const alreadySending = (): AppError =>
	appError("queue_not_waiting", "That message is already being sent.");

export class FollowUpQueue {
	readonly store: StoreApi<FollowUpQueueState>;
	readonly #deps: FollowUpQueueDeps;
	/** Only the newest load of a chat may replace its rows. */
	readonly #loads = createLatestWins<SessionId>();
	/** Whether each chat could release a row at the last live-state change. */
	readonly #releaseable = new Map<SessionId, boolean>();
	/** The last error a chat reported, so one failure pauses the queue once. */
	readonly #lastError = new Map<SessionId, string>();

	constructor(deps: FollowUpQueueDeps) {
		this.#deps = deps;
		this.store = createStore<FollowUpQueueState>(() => ({ bySession: {}, pausedSessionIds: {} }));
	}

	/** Reads a chat's rows and its pause flag. A stale answer never replaces a newer load. */
	async load(sessionId: SessionId): Promise<Result<void>> {
		const ticket = this.#loads.begin(sessionId);
		const [rows, session] = await Promise.all([
			this.#deps.repos.queuedMessages.listBySession(sessionId),
			this.#deps.repos.sessions.get(sessionId),
		]);
		if (!this.#loads.isLatest(ticket)) return ok(undefined);
		this.#loads.settle(ticket);
		if (!rows.ok) return rows;
		if (!session.ok) return session;
		const paused = session.value?.queuePausedAt != null;
		this.store.setState((state) => ({
			bySession: { ...state.bySession, [sessionId]: rows.value },
			pausedSessionIds: { ...state.pausedSessionIds, [sessionId]: paused },
		}));
		return ok(undefined);
	}

	/** Adds a follow-up at the end of its chat's queue. */
	async enqueue(input: {
		sessionId: SessionId;
		text: string;
		attachmentPaths: readonly string[];
		delivery: "queue" | "steer";
	}): Promise<Result<QueuedMessage>> {
		const created = await this.#deps.repos.queuedMessages.enqueue({
			id: this.#deps.newId() as MessageId,
			sessionId: input.sessionId,
			text: input.text,
			attachmentPaths: [...input.attachmentPaths],
			delivery: input.delivery,
		});
		if (!created.ok) return created;
		// A chat whose rows are not in the store yet is read whole, so earlier stored rows are
		// never hidden behind the new one. That read is the newest, so a load already in flight
		// (which may have started before the insert) cannot overwrite it.
		if (this.store.getState().bySession[input.sessionId] === undefined) {
			const loaded = await this.load(input.sessionId);
			return loaded.ok ? created : loaded;
		}
		this.#loads.invalidate(input.sessionId);
		this.#appendRow(created.value);
		return created;
	}

	/** Backs `Actions.sessions.queue.edit`. */
	async edit(messageId: MessageId, text: string): Promise<Result<void>> {
		const found = await this.#deps.repos.queuedMessages.get(messageId);
		if (!found.ok) return found;
		const row = found.value;
		if (row === null) return err(unknownMessage());
		if (row.state === "sending") return err(alreadySending());
		const written = await this.#deps.repos.queuedMessages.setContent(messageId, {
			text,
			attachmentPaths: row.attachmentPaths,
		});
		if (!written.ok) return written;
		if (!written.value) return err(alreadySending());
		this.#loads.invalidate(row.sessionId);
		this.#replaceRow({ ...row, text });
		return ok(undefined);
	}

	/** Backs `Actions.sessions.queue.remove`. A row already sending is left alone. */
	async remove(messageId: MessageId): Promise<Result<void>> {
		const found = await this.#deps.repos.queuedMessages.get(messageId);
		if (!found.ok) return found;
		const row = found.value;
		if (row === null) return err(unknownMessage());
		const removed = await this.#deps.repos.queuedMessages.cancel(messageId);
		if (!removed.ok) return removed;
		if (!removed.value) return err(alreadySending());
		this.#loads.invalidate(row.sessionId);
		this.#removeRow(row.sessionId, messageId);
		return ok(undefined);
	}

	/** Backs `Actions.sessions.queue.reorder`. The list names every waiting row of the chat. */
	async reorder(sessionId: SessionId, orderedIds: readonly MessageId[]): Promise<Result<void>> {
		const written = await this.#deps.repos.queuedMessages.reorder(sessionId, orderedIds);
		if (!written.ok) return written;
		this.#loads.invalidate(sessionId);
		this.#applyOrder(sessionId, orderedIds);
		return ok(undefined);
	}

	/** Backs `Actions.sessions.queue.setPaused`. Resuming lets the chat send its next row. */
	async setPaused(sessionId: SessionId, paused: boolean): Promise<Result<void>> {
		if (paused) {
			const written = await this.#deps.repos.sessions.pauseQueue(sessionId, this.#deps.now());
			if (!written.ok) return written;
		} else {
			const written = await this.#deps.repos.sessions.resumeQueue(sessionId);
			if (!written.ok) return written;
		}
		this.#loads.invalidate(sessionId);
		this.store.setState((state) => ({
			pausedSessionIds: { ...state.pausedSessionIds, [sessionId]: paused },
		}));
		return paused ? ok(undefined) : this.release(sessionId);
	}

	/** Turns a failed row back into waiting and tries it now when the chat can take it. */
	async retry(messageId: MessageId): Promise<Result<void>> {
		const found = await this.#deps.repos.queuedMessages.get(messageId);
		if (!found.ok) return found;
		const row = found.value;
		if (row === null) return err(unknownMessage());
		if (row.state !== "failed") return err(alreadySending());
		const written = await this.#deps.repos.queuedMessages.setState(
			messageId,
			"failed",
			"waiting",
			null,
		);
		if (!written.ok) return written;
		if (!written.value) return err(alreadySending());
		this.#loads.invalidate(row.sessionId);
		this.#replaceRow({ ...row, state: "waiting", lastError: null });
		return this.release(row.sessionId);
	}

	/**
	 * Backs `Actions.sessions.queue.sendNowAsSteer`. Marks one waiting row as a steer, claims it so
	 * another sender cannot take it, and hands it to the sidecar at once. On success the row is gone
	 * because the message now lives in the send path. On failure the row keeps the error and goes
	 * back to its earlier delivery mode, so the user can retry it as a follow-up.
	 */
	async sendNowAsSteer(messageId: MessageId): Promise<Result<void>> {
		const found = await this.#deps.repos.queuedMessages.get(messageId);
		if (!found.ok) return found;
		const row = found.value;
		if (row === null) {
			return err(unknownMessage());
		}
		if (row.state !== "waiting") {
			return err(alreadySending());
		}

		const session = await this.#deps.repos.sessions.get(row.sessionId);
		if (!session.ok) return session;
		if (session.value === null) {
			return err(appError("session_unknown", "That chat no longer exists."));
		}
		const working = this.#deps.liveStateOf(row.sessionId)?.status === "working";
		if (working && !agentCanSteer(session.value.config)) {
			return err(
				appError("steer_unsupported", "This agent cannot be steered. The message stays queued."),
			);
		}

		const originalDelivery = row.delivery;
		if (originalDelivery !== "steer") {
			const marked = await this.#deps.repos.queuedMessages.setDelivery(row.id, "steer");
			if (!marked.ok) return marked;
			if (!marked.value) {
				return err(alreadySending());
			}
		}
		const claimed = await this.#deps.repos.queuedMessages.setState(
			row.id,
			"waiting",
			"sending",
			null,
		);
		if (!claimed.ok) return claimed;
		if (!claimed.value) {
			return err(alreadySending());
		}

		this.#replaceRow({ ...row, delivery: "steer", state: "sending" });
		const sent = await this.#deps.deliver({ ...row, delivery: "steer", state: "sending" });
		if (!sent.ok) {
			const failed = await this.#deps.repos.queuedMessages.setState(
				row.id,
				"sending",
				"failed",
				sent.error.message,
			);
			const restored = await this.#deps.repos.queuedMessages.setDelivery(row.id, originalDelivery);
			this.#replaceRow({
				...row,
				delivery: originalDelivery,
				state: failed.ok && failed.value ? "failed" : row.state,
				lastError: sent.error.message,
			});
			if (!failed.ok) return failed;
			if (!restored.ok) return restored;
			return sent;
		}

		const removed = await this.#deps.repos.queuedMessages.remove(row.id);
		this.#removeRow(row.sessionId, row.id);
		return removed.ok ? ok(undefined) : removed;
	}

	/** Replaces one row in the loaded queue, when that chat has rows in the store. */
	#replaceRow(row: QueuedMessage): void {
		this.store.setState((state) => {
			const rows = state.bySession[row.sessionId];
			if (rows === undefined) return {};
			return {
				bySession: {
					...state.bySession,
					[row.sessionId]: rows.map((entry) => (entry.id === row.id ? row : entry)),
				},
			};
		});
	}

	/** Adds one row to a chat whose rows are already in the store. */
	#appendRow(row: QueuedMessage): void {
		this.store.setState((state) => {
			const loaded = state.bySession[row.sessionId];
			if (loaded === undefined) return {};
			const rows = [...loaded, row].sort(byPosition);
			return { bySession: { ...state.bySession, [row.sessionId]: rows } };
		});
	}

	/** Drops one row from the loaded queue after its message was accepted. */
	#removeRow(sessionId: SessionId, messageId: MessageId): void {
		this.store.setState((state) => {
			const rows = state.bySession[sessionId];
			if (rows === undefined) return {};
			return {
				bySession: {
					...state.bySession,
					[sessionId]: rows.filter((entry) => entry.id !== messageId),
				},
			};
		});
	}

	/** Shows the rows in the given order. Rows not named keep their order after them. */
	#applyOrder(sessionId: SessionId, orderedIds: readonly MessageId[]): void {
		this.store.setState((state) => {
			const rows = state.bySession[sessionId];
			if (rows === undefined) return {};
			const byId = new Map(rows.map((row) => [row.id, row]));
			const named = orderedIds.flatMap((id) => {
				const row = byId.get(id);
				return row === undefined ? [] : [row];
			});
			const chosen = new Set(orderedIds);
			const rest = rows.filter((row) => !chosen.has(row.id)).sort(byPosition);
			const next = [...named, ...rest].map((row, index) => ({ ...row, position: index + 1 }));
			return { bySession: { ...state.bySession, [sessionId]: next } };
		});
	}

	/**
	 * Called when a chat's live state may have changed. Sends one row when the chat becomes able
	 * to take one, and pauses the queue once when a new turn failure appears. A send or pause that
	 * fails is logged.
	 */
	observeLiveState(sessionId: SessionId): void {
		const live = this.#deps.liveStateOf(sessionId);
		const error = live?.error ?? null;
		const previous = this.#lastError.get(sessionId) ?? null;
		const newError = error !== null && error !== previous;
		if (error === null) this.#lastError.delete(sessionId);
		else this.#lastError.set(sessionId, error);

		const releaseable = live !== undefined && canReleaseQueue(live);
		const wasReleaseable = this.#releaseable.get(sessionId) ?? false;
		this.#releaseable.set(sessionId, releaseable);

		// A failed turn pauses first: its queued follow-ups must not fire into the broken chat.
		if (newError) {
			void this.setPaused(sessionId, true).then((result) => {
				if (!result.ok) {
					this.#deps.log?.(
						"warn",
						`Failed to pause queue after failed turn: ${result.error.message}`,
					);
				}
			});
			return;
		}

		if (releaseable && !wasReleaseable) {
			void this.release(sessionId).then((result) => {
				if (!result.ok) {
					this.#deps.log?.("warn", `Failed to send a queued message: ${result.error.message}`);
				}
			});
		}
	}

	/**
	 * Called when a chat goes idle or the user resumes the queue. Sends at most one message: the
	 * first steer row, or the first queue row unless paused. A failed row is marked failed and
	 * the next waiting row is tried.
	 */
	async release(sessionId: SessionId): Promise<Result<void>> {
		const live = this.#deps.liveStateOf(sessionId);
		if (live === undefined || !canReleaseQueue(live)) return ok(undefined);
		if (this.#deps.isHeld?.(sessionId) === true) return ok(undefined);

		if (this.store.getState().bySession[sessionId] === undefined) {
			const loaded = await this.load(sessionId);
			if (!loaded.ok) return loaded;
		}

		let failure: AppError | undefined;
		for (;;) {
			const state = this.store.getState();
			const rows = state.bySession[sessionId] ?? [];
			const paused = state.pausedSessionIds[sessionId] ?? false;
			const next = nextToSend(rows, paused);
			if (next === null) break;

			const claimed = await this.#deps.repos.queuedMessages.setState(
				next.id,
				"waiting",
				"sending",
				null,
			);
			if (!claimed.ok) return claimed;
			if (!claimed.value) {
				const reloaded = await this.load(sessionId);
				if (!reloaded.ok) return reloaded;
				continue;
			}

			const sending: QueuedMessage = { ...next, state: "sending" };
			this.#replaceRow(sending);
			const sent = await this.#deps.deliver(sending);
			if (!sent.ok) {
				failure ??= sent.error;
				const failed = await this.#deps.repos.queuedMessages.setState(
					next.id,
					"sending",
					"failed",
					sent.error.message,
				);
				if (!failed.ok) return failed;
				if (failed.value) {
					this.#replaceRow({ ...next, state: "failed", lastError: sent.error.message });
				}
				this.#deps.log?.("warn", `Failed to send a queued message: ${sent.error.message}`);
				continue;
			}

			const removed = await this.#deps.repos.queuedMessages.remove(next.id);
			if (!removed.ok) return removed;
			this.#removeRow(sessionId, next.id);
			return ok(undefined);
		}
		return failure === undefined ? ok(undefined) : err(failure);
	}

	/**
	 * Called by cancel (CHAT-05): pauses the queue and keeps every waiting row. A row already
	 * `sending` was handed to the sidecar but not delivered, so it goes back to waiting at the end
	 * of the queue (services-map.md 2.3.3).
	 */
	async pauseOnCancel(sessionId: SessionId): Promise<Result<void>> {
		const paused = await this.setPaused(sessionId, true);
		if (!paused.ok) return paused;

		const listed = await this.#deps.repos.queuedMessages.listBySession(sessionId);
		if (!listed.ok) return listed;
		const sending = listed.value.filter((row) => row.state === "sending");
		let failure: AppError | undefined;
		const moved: MessageId[] = [];
		for (const row of sending) {
			const waiting = await this.#deps.repos.queuedMessages.setState(
				row.id,
				"sending",
				"waiting",
				null,
			);
			if (!waiting.ok) {
				failure = waiting.error;
				continue;
			}
			if (waiting.value) moved.push(row.id);
		}

		if (failure === undefined && moved.length === sending.length && moved.length > 0) {
			const stayed = listed.value.filter((row) => row.state === "waiting").map((row) => row.id);
			const reordered = await this.#deps.repos.queuedMessages.reorder(sessionId, [
				...stayed,
				...moved,
			]);
			if (!reordered.ok) failure = reordered.error;
		}

		const refreshed = await this.#deps.repos.queuedMessages.listBySession(sessionId);
		if (!refreshed.ok) return failure === undefined ? refreshed : err(failure);
		this.store.setState((state) => ({
			bySession: { ...state.bySession, [sessionId]: refreshed.value },
		}));
		return failure === undefined ? ok(undefined) : err(failure);
	}
}

/** Queue rows are shown in their stored order. */
export function byPosition(a: QueuedMessage, b: QueuedMessage): number {
	return a.position - b.position || a.id.localeCompare(b.id);
}
