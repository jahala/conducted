/**
 * @feature CHAT-01 Sessions service: the chat list; CHAT-02 Send a message as a new turn; CHAT-05
 * Cancel a turn; CHAT-27 Retry a failed turn in a new chat
 * Owns: the list of chats per workspace, their stored live state and events in memory, the
 * create, close, reopen, rename, set-title-if-empty, delete and open paths, sending a user
 * message as a new turn or a steer, cancelling a turn: pausing the follow-up queue, withdrawing
 * the open interaction, removing only the pending sends the sidecar dropped, and putting a send
 * that was still in flight back in the composer draft, and starting a failed turn's message
 * again in a new chat of the same workspace.
 * Behaviour: services-map.md 2.3.3 (session operations), 2.2 (the sessions table), 2.3.4
 * (composer outbox: restore to draft), ui-map.md 3.2, sessions-and-chats.md "What happens when
 * you send a message" and "While the agent is working" (cancel), sessions.md 6.
 * Must handle: a closed chat stays in history and leaves the open list; a reopened chat returns to
 * the open list; an empty title is refused; stored events load once, in `idx` order; a message is
 * held in memory as pending before the sidecar is asked; a send that fails keeps its text for
 * Retry and Discard; a chat config is written only while the stored config is still the one the
 * caller saw, so a late answer cannot overwrite a newer choice; a cancel withdraws the open
 * interaction, takes back the messages the sidecar dropped and returns an in-flight send to the
 * draft; a sidecar that refuses the cancel changes nothing; cancelAll reaches every working chat
 * of a workspace and no idle one; a live state from the sidecar is shown as it arrives and an
 * open interaction in it becomes the chat's card, while a live state without one withdraws the
 * card; a chat the sidecar lost gets every open turn closed as `interrupted` in one transaction
 * and an idle live state, while its agent session id stays for resume and a failed live-state
 * write is returned.
 * Our design choice: a chat starts with no title; the title generator fills it only once
 * (`setTitleIfEmpty`), so a name the user typed is never overwritten.
 * Our design choice: the pending send lives in memory until the sidecar stores its `user_message`
 * event; it is not a database row yet.
 * Our design choice: cancelling pauses the app queue instead of dropping typed follow-ups (the
 * queue service keeps them), while the messages the sidecar had not delivered come back into the
 * composer draft with their attachments.
 * Test first: a send holds the pending message in memory before it reaches the sidecar, a late
 * config write leaves the newer stored choice in place, a cancel pauses the queue and returns
 * the dropped message to the draft, and a retry in a new chat sends the failed turn's message
 * there.
 *
 * The progress and unread paths live in the same service but belong to CHAT-13 and NAV-11. They
 * are placeholders until those features build them. The chat view (turns built from stored
 * events) belongs to CHAT-07. Cancel is CHAT-05's, and the interaction paths (answer,
 * requestInteraction) are CHAT-10's. CHAT-18 owns `applyLiveState` and `markInterrupted` here.
 */
import {
	type AgentLaunch,
	type Interaction,
	type InteractionAnswer,
	type InteractionRequest,
	idleLiveState,
	type LiveState,
	type Progress,
	type SessionConfig,
	type SessionEvent,
	type WorkspaceContext,
} from "@conducted/protocol";
import {
	type AppError,
	appError,
	type EventId,
	err,
	type InteractionId,
	type MessageId,
	notImplemented,
	ok,
	type Result,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Database } from "../../platform/platform.ts";
import type { Draft, NewWorkspaceInput } from "../api.ts";
import { interruptedTurnEvent } from "../db/repair.ts";
import type { Repositories } from "../db/repositories.ts";
import { executeStatement, inTransaction, selectRows, stringifyJson } from "../db/row-codec.ts";
import type { ChatView, Session } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import type { ComposerService } from "./composer.ts";
import { agentCanSteer, chooseDelivery, type FollowUpQueue } from "./follow-up-queue.ts";
import type { NotificationService } from "./notifications.ts";
import { buildTurns, classifyTurnsChange, type StoredEvent } from "./turn-builder.ts";

/**
 * How the git and GitHub services ask the agent to do work. The text lands in the workspace's
 * active chat (the most recently used open one) or in a new chat when there is none.
 */
export interface AgentMessenger {
	sendInstruction(
		workspaceId: WorkspaceId,
		text: string,
		options?: { newChat?: boolean; config?: Partial<SessionConfig> },
	): Promise<Result<SessionId>>;
}

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

/** A message held in memory before it is handed to the sidecar, shown as a running turn meanwhile. */
interface PendingSend {
	messageId: MessageId;
	turnId: TurnId;
	text: string;
	attachmentPaths: string[];
	at: number;
	delivery: "new_turn" | "steer";
}

export interface SessionsState {
	loaded: boolean;
	/** Why the stored chats could not be read, for the chat history and tab strip. */
	loadError?: AppError | null;
	sessions: Readonly<Record<string, Session>>;
	/** Chat ids per workspace, newest first. */
	byWorkspace: Readonly<Record<string, readonly SessionId[]>>;
	liveStates: Readonly<Record<string, LiveState>>;
	/** Chats where cancel was requested and the sidecar has not yet said idle. */
	cancelling: Readonly<Record<string, boolean>>;
	/** Stored events loaded for each opened chat, in `idx` order. */
	events: Readonly<Record<string, readonly StoredEvent[]>>;
	progress: Readonly<
		Record<string, { title?: string; steps: { label: string; status: string }[] }>
	>;
	/** Messages held in memory before the sidecar got them, whose `user_message` event has not arrived yet. */
	sending: Readonly<Record<string, readonly PendingSend[]>>;
	/** Messages the sidecar did not accept, kept for Retry and Discard. */
	failedSends?: Readonly<Record<string, readonly FailedSend[]>>;
	openInteractions: Readonly<
		Record<string, { interactionId: InteractionId; interaction: Interaction }>
	>;
	viewingSessionId: SessionId | null;
}

/** JSON text with object keys in one order, so two equal configs compare equal. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record)
			.filter((key) => record[key] !== undefined)
			.sort();
		return `{${keys
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** Compares two chat configs by value, whatever order their keys were written in. */
function sameConfig(a: SessionConfig, b: SessionConfig): boolean {
	return canonicalJson(a) === canonicalJson(b);
}

/** Open chats are listed newest first, by the last message and then by creation time. */
function compareNewest(a: Session, b: Session): number {
	const aAt = a.lastUserMessageAt ?? a.createdAt;
	const bAt = b.lastUserMessageAt ?? b.createdAt;
	if (aAt !== bAt) return bAt - aAt;
	if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
	return a.id.localeCompare(b.id);
}

export interface SessionsServiceDeps {
	db: Database;
	repositories: () => Repositories;
	/**
	 * Builds repositories on a transaction handle, so several appends commit or roll back together.
	 * The composition root passes the same factory it gives `EventIngest`.
	 */
	repositoriesOn: (db: Database) => Repositories;
	sidecar: Pick<SidecarClient, "request" | "notify">;
	composer: Pick<
		ComposerService,
		"materializeForSend" | "clearDraft" | "draftOf" | "loadDraft" | "saveDraft"
	>;
	queue: Pick<FollowUpQueue, "enqueue" | "release" | "pauseOnCancel" | "store">;
	notifications: Pick<NotificationService, "onLiveStateChanged">;
	/**
	 * How to start the chat's agent, from the composition root. A send fails with a clear error
	 * when it is missing: building a launch here would drop the provider keys and the program path.
	 */
	launchFor?: (session: Session) => AgentLaunch;
	/** Folders and branch facts the sidecar needs to place a chat on disk. */
	workspaceContextOf: (workspaceId: WorkspaceId) => Promise<Result<WorkspaceContext>>;
	/** Default config for a new chat, from settings and the last used model. */
	defaultConfig: (workspaceId: WorkspaceId) => Promise<Result<SessionConfig>>;
	setting: <T>(key: string) => T;
	now: () => number;
	newId: () => string;
}

/**
 * Reuses the turns that did not change, so a memoised list item sees the same object while a
 * reply streams. The differ names the first turn that differs.
 */
function reuseTurns(previous: ChatView["turns"], next: ChatView["turns"]): ChatView["turns"] {
	const change = classifyTurnsChange(previous, next);
	switch (change.kind) {
		case "same":
			return [...previous];
		case "initial":
			return [...next];
		case "cleared":
			return [];
		case "appended":
		case "tail_changed":
			return [...previous.slice(0, change.fromIndex), ...next.slice(change.fromIndex)];
		case "inserted":
			return [...previous.slice(0, change.atIndex), ...next.slice(change.atIndex)];
		case "truncated":
			return [...previous.slice(0, change.toLength)];
	}
}

export class SessionsService implements AgentMessenger {
	readonly store: StoreApi<SessionsState>;
	readonly #deps: SessionsServiceDeps;
	/** The last turn list built per chat, so unchanged turns keep their identity. */
	readonly #turns = new Map<string, ChatView["turns"]>();
	/** Resolvers for the sidecar's open interaction requests, keyed by interaction id. */
	readonly #interactionResolvers = new Map<string, (answer: InteractionAnswer) => void>();
	readonly #interactionPromises = new Map<string, Promise<InteractionAnswer>>();
	/** Bumped by cancel, so a send that finishes afterwards returns to the draft instead of running. */
	readonly #cancelVersions = new Map<string, number>();
	/** Loads of stored events in progress, with the events that arrived meanwhile. */
	readonly #opening = new Map<
		string,
		{ promise: Promise<Result<void>>; buffered: StoredEvent[] }
	>();

	constructor(deps: SessionsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SessionsState>(() => ({
			loaded: false,
			loadError: null,
			sessions: {},
			byWorkspace: {},
			liveStates: {},
			cancelling: {},
			events: {},
			progress: {},
			sending: {},
			failedSends: {},
			openInteractions: {},
			viewingSessionId: null,
		}));
	}

	/** Loads chats and their stored live states. Runs after startup repair. */
	async start(): Promise<Result<void>> {
		const repositories = this.#deps.repositories();
		const workspaces = await repositories.workspaces.listAll();
		if (!workspaces.ok) return this.#failLoad(workspaces);

		const sessions: Session[] = [];
		for (const workspace of workspaces.value) {
			const listed = await repositories.sessions.listByWorkspace(workspace.id, {
				includeClosed: true,
			});
			if (!listed.ok) return this.#failLoad(listed);
			sessions.push(...listed.value);
		}

		const liveStates = await repositories.liveStates.listAll();
		if (!liveStates.ok) return this.#failLoad(liveStates);

		const byId: Record<string, Session> = {};
		for (const session of sessions) byId[session.id] = session;
		const byWorkspace: Record<string, SessionId[]> = {};
		for (const session of sessions) {
			if (session.closedAt !== null) continue;
			const ids = byWorkspace[session.workspaceId] ?? [];
			ids.push(session.id);
			byWorkspace[session.workspaceId] = ids;
		}
		for (const ids of Object.values(byWorkspace)) {
			ids.sort((a, b) => {
				const left = byId[a];
				const right = byId[b];
				return left === undefined || right === undefined ? 0 : compareNewest(left, right);
			});
		}

		this.store.setState({
			loaded: true,
			loadError: null,
			sessions: byId,
			byWorkspace,
			liveStates: Object.fromEntries(
				liveStates.value.map((stored) => [stored.sessionId, stored.liveState]),
			),
		});
		return ok(undefined);
	}

	/** Backs `Actions.sessions.create`. */
	async create(workspaceId: WorkspaceId, config: SessionConfig): Promise<Result<Session>> {
		const created = await this.#deps.repositories().sessions.create({
			workspaceId,
			title: null,
			config,
		});
		if (!created.ok) return created;
		const session = created.value;
		this.store.setState((state) => ({
			sessions: { ...state.sessions, [session.id]: session },
			byWorkspace: {
				...state.byWorkspace,
				[workspaceId]: [session.id, ...(state.byWorkspace[workspaceId] ?? [])],
			},
		}));
		return created;
	}

	/** Starts a chat with the workspace's default config. */
	async createFromDefaults(workspaceId: WorkspaceId): Promise<Result<Session>> {
		const config = await this.#deps.defaultConfig(workspaceId);
		if (!config.ok) return config;
		return this.create(workspaceId, config.value);
	}

	/** Backs `Actions.sessions.close`: hides the tab, keeps the chat in history. */
	async close(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const closed = await this.#deps.repositories().sessions.close(id);
		if (!closed.ok) return closed;
		const at = this.#deps.now();
		this.store.setState((state) => {
			const current = state.sessions[id];
			const next =
				current === undefined
					? state.sessions
					: {
							...state.sessions,
							[id]: { ...current, closedAt: current.closedAt ?? at, updatedAt: at },
						};
			return {
				sessions: next,
				byWorkspace: {
					...state.byWorkspace,
					[found.value.workspaceId]: (state.byWorkspace[found.value.workspaceId] ?? []).filter(
						(openId) => openId !== id,
					),
				},
			};
		});
		return ok(undefined);
	}

	async reopen(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const reopened = await this.#deps.repositories().sessions.reopen(id);
		if (!reopened.ok) return reopened;
		const at = this.#deps.now();
		this.store.setState((state) => {
			const current = state.sessions[id];
			const ids = state.byWorkspace[found.value.workspaceId] ?? [];
			return {
				sessions:
					current === undefined
						? state.sessions
						: { ...state.sessions, [id]: { ...current, closedAt: null, updatedAt: at } },
				byWorkspace: {
					...state.byWorkspace,
					[found.value.workspaceId]: ids.includes(id) ? ids : [id, ...ids],
				},
			};
		});
		return ok(undefined);
	}

	async rename(id: SessionId, title: string): Promise<Result<void>> {
		const trimmed = title.trim();
		if (trimmed.length === 0)
			return { ok: false, error: appError("chat_title_empty", "Enter a chat name.") };
		const found = await this.#session(id);
		if (!found.ok) return found;
		const renamed = await this.#deps.repositories().sessions.setTitle(id, trimmed);
		if (!renamed.ok) return renamed;
		const at = this.#deps.now();
		this.store.setState((state) => {
			const current = state.sessions[id];
			if (current === undefined) return {};
			return {
				sessions: { ...state.sessions, [id]: { ...current, title: trimmed, updatedAt: at } },
			};
		});
		return ok(undefined);
	}

	/**
	 * Sets the title only when the chat has none: what the title generator uses, so a name the
	 * user typed is never overwritten.
	 */
	async setTitleIfEmpty(id: SessionId, title: string): Promise<Result<void>> {
		const trimmed = title.trim();
		if (trimmed.length === 0)
			return { ok: false, error: appError("chat_title_empty", "Enter a chat name.") };
		const found = await this.#session(id);
		if (!found.ok) return found;
		const written = await this.#deps.repositories().sessions.setTitleIfEmpty(id, trimmed);
		if (!written.ok) return written;
		if (!written.value) return ok(undefined);
		const at = this.#deps.now();
		this.store.setState((state) => {
			const current = state.sessions[id];
			if (current === undefined) return {};
			return {
				sessions: { ...state.sessions, [id]: { ...current, title: trimmed, updatedAt: at } },
			};
		});
		return ok(undefined);
	}

	/** Deletes one chat with its stored events and live state. */
	async delete(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const removed = await this.#deps.repositories().sessions.delete(id);
		if (!removed.ok) return removed;
		this.#turns.delete(id);
		this.#cancelVersions.delete(id);
		// An open card would leave the sidecar's request waiting for an answer that never comes.
		const openCard = this.store.getState().openInteractions[id];
		if (openCard !== undefined)
			this.#settleInteraction(openCard.interactionId, { kind: "withdrawn" });
		this.store.setState((state) => {
			const sessions = { ...state.sessions };
			delete sessions[id];
			const liveStates = { ...state.liveStates };
			delete liveStates[id];
			const events = { ...state.events };
			delete events[id];
			const sending = { ...state.sending };
			delete sending[id];
			const failedSends = { ...(state.failedSends ?? {}) };
			delete failedSends[id];
			const openInteractions = { ...state.openInteractions };
			delete openInteractions[id];
			const cancelling = { ...state.cancelling };
			delete cancelling[id];
			return {
				sessions,
				liveStates,
				events,
				sending,
				failedSends,
				openInteractions,
				cancelling,
				byWorkspace: {
					...state.byWorkspace,
					[found.value.workspaceId]: (state.byWorkspace[found.value.workspaceId] ?? []).filter(
						(openId) => openId !== id,
					),
				},
				viewingSessionId: state.viewingSessionId === id ? null : state.viewingSessionId,
			};
		});
		return ok(undefined);
	}

	/**
	 * Loads the stored events of a chat the first time it is shown. Calls that overlap share one
	 * load. An event stored while the load runs is kept and merged in, so it is not lost.
	 */
	open(id: SessionId): Promise<Result<void>> {
		if (this.store.getState().events[id] !== undefined) return Promise.resolve(ok(undefined));
		const inFlight = this.#opening.get(id);
		if (inFlight !== undefined) return inFlight.promise;
		const buffered: StoredEvent[] = [];
		const promise = this.#loadEvents(id, buffered).finally(() => {
			this.#opening.delete(id);
		});
		this.#opening.set(id, { promise, buffered });
		return promise;
	}

	async #loadEvents(id: SessionId, buffered: StoredEvent[]): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const repositories = this.#deps.repositories();
		const last = await repositories.sessionEvents.lastIdx(id);
		if (!last.ok) return last;
		const byIdx = new Map<number, StoredEvent>();
		if (last.value !== null) {
			const stored = await repositories.sessionEvents.listFrom(id, 0, last.value + 1);
			if (!stored.ok) return stored;
			for (const row of stored.value) {
				byIdx.set(row.idx, {
					idx: row.idx,
					event: row.event,
					receivedAt: row.receivedAt,
					revertedAt: row.revertedAt,
				});
			}
		}
		for (const event of buffered) {
			if (!byIdx.has(event.idx)) byIdx.set(event.idx, event);
		}
		const events = [...byIdx.values()].sort((a, b) => a.idx - b.idx);
		this.store.setState((state) => ({ events: { ...state.events, [id]: events } }));
		return ok(undefined);
	}

	/** Materialises attachments, then hands the message to the sidecar. */
	async #prepareAndSend(
		session: Session,
		text: string,
		attachmentPaths: string[],
		delivery: "new_turn" | "steer",
		cancelVersion: number,
	): Promise<Result<void>> {
		const workspace = await this.#workspaceContext(session.workspaceId);
		if (!workspace.ok) return workspace;
		let paths = attachmentPaths;
		if (paths.length > 0) {
			const materialized = await this.#deps.composer.materializeForSend(
				session.id,
				workspace.value.workspacePath,
			);
			if (!materialized.ok) return materialized;
			paths = materialized.value;
		}
		return this.#submit(
			session,
			{
				messageId: this.#deps.newId() as MessageId,
				turnId: this.#deps.newId() as TurnId,
				text,
				attachmentPaths: paths,
				at: this.#deps.now(),
				delivery,
			},
			cancelVersion,
		);
	}

	/**
	 * Keeps the message in memory as pending first, then asks the sidecar for a new turn or a steer.
	 * A failure removes the pending entry and keeps the message for Retry and Discard. A send that
	 * finishes after the user cancelled is not delivered: its text goes back to the draft.
	 */
	async #submit(
		session: Session,
		pending: PendingSend,
		cancelVersion: number,
	): Promise<Result<void>> {
		const launchFor = this.#deps.launchFor;
		if (launchFor === undefined) {
			return err(
				appError(
					"chat_launch_missing",
					"The chat cannot start its agent because no launch settings were provided.",
				),
			);
		}
		const workspace = await this.#workspaceContext(session.workspaceId);
		if (!workspace.ok) return workspace;
		const last = await this.#deps.repositories().sessionEvents.lastIdx(session.id);
		if (!last.ok) return last;

		if (this.#cancelVersionOf(session.id) !== cancelVersion) {
			await this.#restoreDroppedToDraft(session.id, [pending]);
			return err(appError("cancelled", "The message was cancelled before it was sent."));
		}

		const firstMessage = last.value === null;
		this.#setSending(session.id, pending);
		const result = await this.#deps.sidecar.request("sendMessage", {
			sessionId: session.id,
			messageId: pending.messageId,
			turnId: pending.turnId,
			text: pending.text,
			attachmentPaths: pending.attachmentPaths,
			delivery: pending.delivery,
			firstMessage,
			config: session.config,
			workspace: workspace.value,
			launch: launchFor(session),
			...(session.agentSessionId === null
				? {}
				: { resume: { agentSessionId: session.agentSessionId } }),
		});
		if (this.#cancelVersionOf(session.id) !== cancelVersion) {
			// A cancel that dropped this message already put it back in the draft and removed it from
			// the pending list. Restoring it again would show the text twice.
			const cancelTookIt = !(this.store.getState().sending[session.id] ?? []).some(
				(entry) => entry.messageId === pending.messageId,
			);
			this.#removeSending(session.id, pending.messageId);
			if (!cancelTookIt) await this.#restoreDroppedToDraft(session.id, [pending]);
			return err(appError("cancelled", "The message was cancelled before it was sent."));
		}
		if (!result.ok) {
			this.#removeSending(session.id, pending.messageId);
			this.#addFailed(session.id, { ...pending, error: result.error });
			return result;
		}
		return ok(undefined);
	}

	/** The workspace facts for a send, with the user's general instructions when settings have them. */
	async #workspaceContext(workspaceId: WorkspaceId): Promise<Result<WorkspaceContext>> {
		const found = await this.#deps.workspaceContextOf(workspaceId);
		if (!found.ok) return found;
		const preference = this.#deps.setting<string>("custom_prompt_general");
		if (found.value.userPreferences !== undefined || preference.trim().length === 0) {
			return found;
		}
		return ok({ ...found.value, userPreferences: preference });
	}

	#setSending(sessionId: SessionId, pending: PendingSend): void {
		this.store.setState((state) => ({
			sending: {
				...state.sending,
				[sessionId]: [
					...(state.sending[sessionId] ?? []).filter(
						(entry) => entry.messageId !== pending.messageId,
					),
					pending,
				],
			},
		}));
	}

	#removeSending(sessionId: SessionId, messageId: MessageId): void {
		this.store.setState((state) => {
			const current = state.sending[sessionId];
			if (current === undefined) return {};
			const sending = current.filter((entry) => entry.messageId !== messageId);
			return { sending: { ...state.sending, [sessionId]: sending } };
		});
	}

	#addFailed(sessionId: SessionId, failed: FailedSend): void {
		this.store.setState((state) => ({
			failedSends: {
				...(state.failedSends ?? {}),
				[sessionId]: [
					...(state.failedSends?.[sessionId] ?? []).filter(
						(entry) => entry.messageId !== failed.messageId,
					),
					failed,
				],
			},
		}));
	}

	#removeFailed(sessionId: SessionId, messageId: MessageId): void {
		this.store.setState((state) => {
			const failedSends = state.failedSends ?? {};
			const current = failedSends[sessionId];
			if (current === undefined) return {};
			return {
				failedSends: {
					...failedSends,
					[sessionId]: current.filter((entry) => entry.messageId !== messageId),
				},
			};
		});
	}

	#setConfig(sessionId: SessionId, config: SessionConfig, updatedAt: number): void {
		this.store.setState((state) => {
			const current = state.sessions[sessionId];
			if (current === undefined) return {};
			return {
				sessions: { ...state.sessions, [sessionId]: { ...current, config, updatedAt } },
			};
		});
	}

	#failLoad<T>(failure: { ok: false; error: AppError }): Result<T> {
		this.store.setState({ loadError: failure.error });
		return failure;
	}

	async #session(id: SessionId): Promise<Result<Session>> {
		const cached = this.store.getState().sessions[id];
		if (cached !== undefined) return ok(cached);
		const stored = await this.#deps.repositories().sessions.get(id);
		if (!stored.ok) return stored;
		if (stored.value === null)
			return { ok: false, error: appError("session_unknown", "That chat no longer exists.") };
		return ok(stored.value);
	}

	/**
	 * Backs `Actions.sessions.send`. An idle chat starts a new turn. A working chat queues the
	 * message or steers it, following the user's default or the requested mode.
	 */
	async send(
		id: SessionId,
		text: string,
		attachmentPaths: readonly string[],
		delivery: "auto" | "queue" | "steer",
	): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const session = found.value;
		const cancelVersion = this.#cancelVersionOf(id);
		const liveState = this.store.getState().liveStates[id] ?? idleLiveState;
		const defaultMode =
			this.#deps.setting<string>("default_message_send_mode") === "queue" ? "queue" : "steer";
		const decision = chooseDelivery({
			mode: delivery,
			working: liveState.status === "working",
			defaultMode,
			canSteer: agentCanSteer(session.config),
		});

		if (decision === "queue") {
			const queued = await this.#deps.queue.enqueue({
				sessionId: id,
				text,
				attachmentPaths: [...attachmentPaths],
				delivery: "queue",
			});
			return queued.ok ? ok(undefined) : queued;
		}

		return this.#prepareAndSend(
			session,
			text,
			[...attachmentPaths],
			decision === "steer" ? "steer" : "new_turn",
			cancelVersion,
		);
	}

	/** Implements `AgentMessenger`: the path for "Commit and push", "Create PR", "Fix errors" and similar. */
	async sendInstruction(
		workspaceId: WorkspaceId,
		text: string,
		options?: { newChat?: boolean; config?: Partial<SessionConfig> },
	): Promise<Result<SessionId>> {
		let session: Session | undefined;
		if (options?.newChat !== true) {
			const open = this.store.getState().byWorkspace[workspaceId] ?? [];
			const first = open[0];
			session = first === undefined ? undefined : this.store.getState().sessions[first];
		}

		if (session === undefined) {
			const config = await this.#deps.defaultConfig(workspaceId);
			if (!config.ok) return config;
			const created = await this.create(
				workspaceId,
				options?.config === undefined ? config.value : { ...config.value, ...options.config },
			);
			if (!created.ok) return created;
			session = created.value;
		} else if (options?.config !== undefined) {
			const updated = await this.updateConfig(session.id, { ...session.config, ...options.config });
			if (!updated.ok) return updated;
			session = this.store.getState().sessions[session.id] ?? session;
		}

		const sent = await this.send(session.id, text, [], "auto");
		return sent.ok ? ok(session.id) : sent;
	}

	/**
	 * Backs `Actions.sessions.cancel`. Stops the turn through the sidecar, which takes the end
	 * checkpoint, drops its queued messages and withdraws interactions. Here the app pauses its
	 * own follow-up queue, withdraws the interaction it shows, removes only the dropped pending
	 * sends, and puts those messages back in the composer draft with their attachments.
	 */
	async cancel(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;

		const previousCancelVersion = this.#cancelVersionOf(id);
		this.#cancelVersions.set(id, previousCancelVersion + 1);
		this.#setCancelling(id, true);
		const cancelled = await this.#deps.sidecar.request("cancel", { sessionId: id });
		if (!cancelled.ok) {
			this.#cancelVersions.set(id, previousCancelVersion);
			this.#setCancelling(id, false);
			return cancelled;
		}

		const open = this.store.getState().openInteractions[id];
		if (open !== undefined) this.#settleInteraction(open.interactionId, { kind: "withdrawn" });
		const dropped = new Set(cancelled.value.droppedMessageIds);
		const pending = this.store.getState().sending[id] ?? [];
		const toRestore = pending.filter((entry) => dropped.has(entry.messageId));
		// Take the dropped messages off the pending list before any await, so a send that finishes
		// meanwhile sees that the cancel owns them.
		for (const messageId of dropped) this.#removeSending(id, messageId);
		const paused = await this.#deps.queue.pauseOnCancel(id);
		const restored = await this.#restoreDroppedToDraft(id, toRestore);
		this.#setCancelling(id, false);
		return paused.ok ? restored : paused;
	}

	#setCancelling(sessionId: SessionId, cancelling: boolean): void {
		this.store.setState((state) => ({
			cancelling: { ...state.cancelling, [sessionId]: cancelling },
		}));
	}

	#cancelVersionOf(sessionId: SessionId): number {
		return this.#cancelVersions.get(sessionId) ?? 0;
	}

	/** Puts the messages the sidecar dropped before delivering them back in the composer draft. */
	async #restoreDroppedToDraft(
		sessionId: SessionId,
		dropped: readonly PendingSend[],
	): Promise<Result<void>> {
		if (dropped.length === 0) return ok(undefined);
		const loaded = await this.#deps.composer.loadDraft(sessionId);
		if (!loaded.ok) return loaded;

		const segments = dropped.map((entry) => entry.text).filter((text) => text.trim().length > 0);
		const existing = loaded.value.text;
		if (existing.trim().length > 0 && !segments.includes(existing)) segments.push(existing);

		const attachmentPaths = [
			...new Set([
				...loaded.value.attachmentPaths,
				...dropped.flatMap((entry) => entry.attachmentPaths),
			]),
		];
		this.#deps.composer.saveDraft(sessionId, {
			text: segments.join("\n\n"),
			attachmentPaths,
		});
		return ok(undefined);
	}

	/**
	 * Backs `Actions.sessions.answer`. A superseded answer is not an error: the card was already
	 * withdrawn. A refusal with neither flag means the sidecar did not take the answer, so the card
	 * stays open and the user can try again.
	 */
	async answer(
		sessionId: SessionId,
		interactionId: InteractionId,
		answer: InteractionAnswer,
	): Promise<Result<void>> {
		const result = await this.#deps.sidecar.request("answerInteraction", {
			sessionId,
			interactionId,
			answer,
		});
		if (!result.ok) return result;
		if (result.value.accepted) this.#settleInteraction(interactionId, answer);
		else if (result.value.superseded) {
			this.#settleInteraction(interactionId, { kind: "withdrawn" });
		} else {
			return err(appError("interaction_not_accepted", "Could not send answers. Try again."));
		}
		return ok(undefined);
	}

	/** True while the chat shows a question, approval or another card the agent waits on. */
	hasPendingConsentInteraction(sessionId: SessionId): boolean {
		return this.store.getState().openInteractions[sessionId] !== undefined;
	}

	/** Called by the `requestInteraction` handler. Resolves when the user answers or it is withdrawn. */
	requestInteraction(request: InteractionRequest): Promise<InteractionAnswer> {
		const existing = this.#interactionPromises.get(request.interactionId);
		if (existing !== undefined) {
			this.#showInteraction(request);
			return existing;
		}

		const open = this.store.getState().openInteractions[request.sessionId];
		if (open !== undefined && open.interactionId !== request.interactionId) {
			this.#settleInteraction(open.interactionId, { kind: "withdrawn" });
		}

		let resolve!: (answer: InteractionAnswer) => void;
		const promise = new Promise<InteractionAnswer>((settle) => {
			resolve = settle;
		});
		this.#interactionResolvers.set(request.interactionId, resolve);
		this.#interactionPromises.set(request.interactionId, promise);
		this.#showInteraction(request);
		return promise;
	}

	/** Shows one open interaction per chat, replacing the card that was there before. */
	#showInteraction(request: InteractionRequest): void {
		this.store.setState((state) => ({
			openInteractions: {
				...state.openInteractions,
				[request.sessionId]: {
					interactionId: request.interactionId,
					interaction: request.interaction,
				},
			},
		}));
	}

	/** Answers the sidecar's open request and removes the card. A stale id is ignored. */
	#settleInteraction(interactionId: InteractionId, answer: InteractionAnswer): void {
		const resolve = this.#interactionResolvers.get(interactionId);
		this.#interactionResolvers.delete(interactionId);
		this.#interactionPromises.delete(interactionId);
		this.store.setState((state) => {
			const openInteractions = { ...state.openInteractions };
			let changed = false;
			for (const [sessionId, open] of Object.entries(openInteractions)) {
				if (open.interactionId !== interactionId) continue;
				delete openInteractions[sessionId];
				changed = true;
			}
			return changed ? { openInteractions } : {};
		});
		resolve?.(answer);
	}

	/**
	 * Backs `Actions.sessions.updateConfig`. Some changes apply live, some on the next turn.
	 * The write is a compare-and-set on the config text: a late update cannot overwrite a newer
	 * choice. When it loses, the newer stored config is adopted instead.
	 */
	async updateConfig(id: SessionId, config: SessionConfig): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const session = found.value;

		// Read the exact stored text first, so the guard below names the text the write replaces.
		// Keys in another order or extra whitespace would make a re-serialised guard miss.
		const raw = await selectRows<{ config: string }>(
			this.#deps.db,
			"SELECT config FROM sessions WHERE id = $1",
			[id],
			"Reading a chat config",
		);
		if (!raw.ok) return raw;
		const storedText = raw.value[0]?.config;
		if (storedText === undefined) {
			return err(appError("session_unknown", "That chat no longer exists."));
		}

		// Read the stored row again: the cached config is what the caller saw, not what is there now.
		const stored = await this.#deps.repositories().sessions.get(id);
		if (!stored.ok) return stored;
		if (stored.value === null) {
			return err(appError("session_unknown", "That chat no longer exists."));
		}
		const storedSession = stored.value;

		// The caller's choice is older than the stored one, so adopt the stored choice.
		if (!sameConfig(storedSession.config, session.config)) {
			this.#setConfig(id, storedSession.config, storedSession.updatedAt);
			return ok(undefined);
		}
		if (sameConfig(storedSession.config, config)) return ok(undefined);

		const next = stringifyJson(config, "sessions.config");
		if (!next.ok) return next;

		const at = this.#deps.now();
		const written = await executeStatement(
			this.#deps.db,
			"UPDATE sessions SET config = $1, updated_at = $2 WHERE id = $3 AND config = $4",
			[next.value, at, id, storedText],
			"Saving a chat config",
		);
		if (!written.ok) return written;

		if (written.value === 0) {
			// Another writer got there first. Adopt its choice; if the row is gone, say so.
			const latest = await this.#deps.repositories().sessions.get(id);
			if (!latest.ok) return latest;
			if (latest.value === null) {
				return err(appError("session_unknown", "That chat no longer exists."));
			}
			this.#setConfig(id, latest.value.config, latest.value.updatedAt);
			return ok(undefined);
		}

		this.#setConfig(id, config, at);
		const applied = await this.#deps.sidecar.request("updateConfig", {
			sessionId: id,
			config,
		});
		return applied.ok ? ok(undefined) : applied;
	}

	/**
	 * Backs `Actions.sessions.startFromPlan`: the chosen chat, or a new chat in the same workspace
	 * when `target` is null, carries out the plan.
	 */
	startFromPlan(
		_id: SessionId,
		_planText: string,
		_target: SessionId | null,
	): Promise<Result<Session>> {
		return notImplemented("CHAT-12");
	}

	/** Backs `Actions.app.createDiagnosticsChat`: saves the redacted report and starts a chat with it attached. */
	createDiagnosticsChat(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("APP-03");
	}

	/** Backs `Actions.sessions.copyTranscript`. */
	copyTranscript(_id: SessionId, _detail: "concise" | "full"): Promise<Result<void>> {
		return notImplemented("CHAT-17");
	}

	// ---- the port the workspace service uses (WorkspaceSessionsPort) ----

	/** Creates the first chat of a new workspace and sends the prompt, unless the prompt is empty. */
	async createFirstChat(
		workspaceId: WorkspaceId,
		input: NewWorkspaceInput,
	): Promise<Result<Session>> {
		const created = await this.create(workspaceId, input.config);
		if (!created.ok) return created;
		if (input.prompt.trim() === "" && input.attachmentPaths.length === 0) return created;
		const sent = await this.send(created.value.id, input.prompt, input.attachmentPaths, "auto");
		return sent.ok ? created : sent;
	}

	/** The first chat's draft, for "Recover prompt" after a failed creation (WS-01). */
	async firstDraftOf(workspaceId: WorkspaceId): Promise<Result<Draft>> {
		const listed = await this.#deps.repositories().sessions.listByWorkspace(workspaceId, {
			includeClosed: true,
		});
		if (!listed.ok) return listed;
		const first = listed.value[0];
		if (first === undefined) {
			return err(
				appError("workspace_draft_missing", "This workspace has no first message to recover."),
			);
		}
		return ok(this.#deps.composer.draftOf(first.id));
	}

	/** Cancels every working chat of a workspace. Used before archive and delete. */
	async cancelAll(workspaceId: WorkspaceId): Promise<Result<void>> {
		const ids = [...(this.store.getState().byWorkspace[workspaceId] ?? [])];
		let failure: AppError | undefined;
		for (const id of ids) {
			if (!this.#chatIsWorking(id)) continue;
			const cancelled = await this.cancel(id);
			if (!cancelled.ok && failure === undefined) failure = cancelled.error;
		}
		return failure === undefined ? ok(undefined) : err(failure);
	}

	hasWorkingChats(workspaceId: WorkspaceId): boolean {
		const ids = this.store.getState().byWorkspace[workspaceId] ?? [];
		return ids.some((id) => this.#chatIsWorking(id));
	}

	/** A chat counts as working until its cancel has been answered and the chat is idle again. */
	#chatIsWorking(sessionId: SessionId): boolean {
		const state = this.store.getState();
		return (
			state.cancelling[sessionId] === true || state.liveStates[sessionId]?.status === "working"
		);
	}

	/** Backs `Actions.workspaces.markRead`. */
	markAllRead(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("NAV-11");
	}

	/** Deletes the chats, events and attachment files of a workspace that is being removed. */
	deleteAll(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("WS-10");
	}

	/** Starts a chat with the review model and sends `text`. Used by the AI review. */
	startReviewChat(_workspaceId: WorkspaceId, _text: string): Promise<Result<Session>> {
		return notImplemented("REV-05");
	}

	// ---- called by the sidecar side (core/sidecar) ----

	/**
	 * Shows the sidecar's live state. A new state replaces the one before it. An interaction the
	 * new state no longer carries is settled as withdrawn, so a stale card never stays on screen.
	 */
	async applyLiveState(sessionId: SessionId, liveState: LiveState): Promise<Result<void>> {
		const at = this.#deps.now();
		const previous = this.store.getState().openInteractions[sessionId];
		const nextOpen = liveState.openInteraction;
		this.store.setState((state) => {
			const next: Partial<SessionsState> = {
				liveStates: { ...state.liveStates, [sessionId]: liveState },
			};
			const openInteractions = { ...state.openInteractions };
			let changed = false;
			if (nextOpen !== undefined) {
				openInteractions[sessionId] = {
					interactionId: nextOpen.interactionId,
					interaction: nextOpen.interaction,
				};
				changed = true;
			} else if (openInteractions[sessionId] !== undefined) {
				delete openInteractions[sessionId];
				changed = true;
			}
			if (changed) next.openInteractions = openInteractions;
			return next;
		});
		if (previous !== undefined && previous.interactionId !== nextOpen?.interactionId) {
			this.#settleInteraction(previous.interactionId, { kind: "withdrawn" });
		}
		const written = await this.#deps.repositories().liveStates.upsert(sessionId, liveState, at);
		return written.ok ? ok(undefined) : err(written.error);
	}

	applyStoredEvent(
		sessionId: SessionId,
		idx: number,
		event: SessionEvent,
		receivedAt: number,
	): void {
		this.#opening.get(sessionId)?.buffered.push({ idx, event, receivedAt, revertedAt: null });
		const closedInteractionId =
			event.type === "turn_ended"
				? (this.store.getState().openInteractions[sessionId]?.interactionId ?? null)
				: null;
		this.store.setState((state) => {
			const loaded = state.events[sessionId];
			const duplicate = loaded?.some((stored) => stored.idx === idx) ?? false;
			const events =
				loaded !== undefined && !duplicate
					? {
							...state.events,
							[sessionId]: [...loaded, { idx, event, receivedAt, revertedAt: null }],
						}
					: state.events;

			const pending = state.sending[sessionId];
			let settled = pending;
			if (pending !== undefined && event.type === "user_message") {
				const left = pending.filter((entry) => entry.messageId !== event.messageId);
				if (left.length !== pending.length) settled = left;
			} else if (pending !== undefined && event.type === "turn_ended") {
				const left = pending.filter((entry) => entry.turnId !== event.turnId);
				if (left.length !== pending.length) settled = left;
			}
			const sendingChanged = settled !== pending;

			const open = state.openInteractions[sessionId];
			const closeInteraction = event.type === "turn_ended" && open !== undefined;
			if (events === state.events && !closeInteraction && !sendingChanged) return {};

			const next: Partial<SessionsState> = {};
			if (events !== state.events) next.events = events;
			if (sendingChanged) {
				next.sending = { ...state.sending, [sessionId]: settled ?? [] };
			}
			if (closeInteraction) {
				const openInteractions = { ...state.openInteractions };
				delete openInteractions[sessionId];
				next.openInteractions = openInteractions;
			}
			return next;
		});
		if (closedInteractionId !== null) {
			this.#settleInteraction(closedInteractionId, { kind: "withdrawn" });
		}
	}

	async setAgentSessionId(sessionId: SessionId, agentSessionId: string): Promise<Result<void>> {
		const written = await this.#deps
			.repositories()
			.sessions.setAgentSessionId(sessionId, agentSessionId);
		if (!written.ok) return written;
		const at = this.#deps.now();
		this.store.setState((state) => {
			const current = state.sessions[sessionId];
			if (current === undefined || current.agentSessionId === agentSessionId) return {};
			return {
				sessions: {
					...state.sessions,
					[sessionId]: { ...current, agentSessionId, updatedAt: at },
				},
			};
		});
		return ok(undefined);
	}

	/** Replaces the chat's progress tracker. An update with no blocks clears it. */
	setProgress(_sessionId: SessionId, _progress: Progress): void {
		notImplemented("CHAT-13");
	}

	/**
	 * Closes every turn the sidecar lost: appends `turn_ended` with outcome "interrupted" in one
	 * transaction, then writes the idle live state. The store shows the events only after they
	 * committed, and a failed live-state write is returned rather than hidden.
	 */
	async markInterrupted(sessionId: SessionId): Promise<Result<void>> {
		const open = await this.#deps.repositories().sessionEvents.findInterruptedTurns(sessionId);
		if (!open.ok) return open;
		const at = this.#deps.now();
		const appended = await inTransaction(
			this.#deps.db,
			"Closing turns cut off by a crash",
			async (tx) => {
				const repositories = this.#deps.repositoriesOn(tx);
				const stored: { idx: number; event: SessionEvent }[] = [];
				for (const turn of open.value) {
					const event = interruptedTurnEvent(turn.turnId, this.#deps.newId() as EventId, at);
					const result = await repositories.sessionEvents.append(sessionId, event, at);
					if (!result.ok) return err(result.error);
					if (result.value.kind === "appended") {
						stored.push({ idx: result.value.idx, event });
					}
				}
				return ok(stored);
			},
		);
		if (!appended.ok) return appended;
		for (const entry of appended.value) {
			this.applyStoredEvent(sessionId, entry.idx, entry.event, at);
		}
		return this.applyLiveState(sessionId, idleLiveState);
	}

	// ---- called by the views ----

	setViewing(_sessionId: SessionId | null): void {
		notImplemented("NAV-11");
	}

	/** Backs `useChat`. Null for an unknown chat. */
	chatView(sessionId: SessionId): ChatView | null {
		const state = this.store.getState();
		const session = state.sessions[sessionId];
		if (session === undefined) return null;

		const liveState = state.liveStates[sessionId] ?? idleLiveState;
		const pending = (state.sending[sessionId] ?? []).map((send) => ({
			...send,
			messageId: send.messageId as MessageId,
		}));
		const fresh = buildTurns(state.events[sessionId] ?? [], liveState, pending);
		const previous = this.#turns.get(sessionId);
		const turns = previous === undefined ? fresh : reuseTurns(previous, fresh);
		this.#turns.set(sessionId, turns);

		const open = state.openInteractions[sessionId];
		return {
			session,
			turns,
			liveState,
			queued: [...(this.#deps.queue.store.getState().bySession[sessionId] ?? [])],
			openInteraction:
				open === undefined
					? null
					: {
							interactionId: open.interactionId,
							interaction: open.interaction,
							expiresAt: null,
							timedOut: false,
						},
			progress: null,
			goal: null,
		};
	}

	/** Backs `useDraft` through the composer service; kept here so the view model has one source. */
	draftOf(sessionId: SessionId): Draft {
		return this.#deps.composer.draftOf(sessionId);
	}

	// ---- read state, failed sends and agent controls (Actions.sessions)

	markRead(_id: SessionId): Promise<Result<void>> {
		return notImplemented("NAV-11");
	}

	markUnread(_id: SessionId): Promise<Result<void>> {
		return notImplemented("NAV-11");
	}

	/** Backs `Actions.workspaces.markUnread`: the workspace's newest chat becomes unread. */
	markWorkspaceUnread(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("NAV-11");
	}

	/** Sends a message the sidecar did not accept again, with the same ids. */
	async retryFailedSend(id: SessionId, messageId: MessageId): Promise<Result<void>> {
		const failed = (this.store.getState().failedSends?.[id] ?? []).find(
			(entry) => entry.messageId === messageId,
		);
		if (failed === undefined) {
			return {
				ok: false,
				error: appError("failed_send_unknown", "That message is no longer waiting to be sent."),
			};
		}
		const found = await this.#session(id);
		if (!found.ok) return found;
		const cancelVersion = this.#cancelVersionOf(id);
		this.#removeFailed(id, messageId);
		const submitted = await this.#submit(found.value, failed, cancelVersion);
		// A failure before the sidecar was asked must not lose the message. A cancel has already
		// put it back in the draft.
		if (!submitted.ok && submitted.error.code !== "cancelled") {
			this.#addFailed(id, { ...failed, error: submitted.error });
		}
		return submitted;
	}

	/** Drops a message the sidecar did not accept and puts its text back in the composer. */
	async discardFailedSend(id: SessionId, messageId: MessageId): Promise<Result<void>> {
		const failed = (this.store.getState().failedSends?.[id] ?? []).find(
			(entry) => entry.messageId === messageId,
		);
		if (failed === undefined) return ok(undefined);

		const loaded = await this.#deps.composer.loadDraft(id);
		if (!loaded.ok) return loaded;
		const draft = loaded.value;
		this.#removeFailed(id, messageId);
		// The composer keeps its draft after a failed send, so the draft may already hold this
		// text. Restoring it again would show the message twice.
		let text: string;
		if (draft.text.trim().length === 0) {
			text = failed.text;
		} else if (draft.text.trim() === failed.text.trim()) {
			text = draft.text;
		} else {
			text = `${failed.text}\n\n${draft.text}`;
		}
		this.#deps.composer.saveDraft(id, {
			text,
			attachmentPaths: [...new Set([...draft.attachmentPaths, ...failed.attachmentPaths])],
		});
		return ok(undefined);
	}

	/**
	 * Backs `Actions.sessions.retryInNewChat`: sends a failed turn's message again in a new chat of
	 * the same workspace, with the failed chat's config. The old chat stays open and unchanged.
	 */
	async retryInNewChat(id: SessionId, turnId: TurnId): Promise<Result<Session>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const session = found.value;
		const state = this.store.getState();
		const liveState = state.liveStates[id] ?? idleLiveState;
		const turns = buildTurns(state.events[id] ?? [], liveState);
		const turn = turns.find((candidate) => candidate.turnId === turnId);
		if (turn === undefined) {
			return err(appError("chat_turn_unknown", "That turn is no longer in this chat."));
		}
		const message = turn.userMessage;
		if (message === null) {
			return err(
				appError(
					"chat_turn_no_message",
					"This turn was not started by you, so there is no message to retry.",
				),
			);
		}

		const created = await this.create(session.workspaceId, session.config);
		if (!created.ok) return created;
		const sent = await this.send(created.value.id, message.text, message.attachmentPaths, "auto");
		return sent.ok ? created : sent;
	}

	/** /restart: `resetAgent`, then warm the agent again with resume. */
	restartAgent(_id: SessionId): Promise<Result<void>> {
		return notImplemented("COMP-06");
	}

	compact(_id: SessionId): Promise<Result<void>> {
		return notImplemented("AGENT-14");
	}

	async setAutoApproveEdits(id: SessionId, enabled: boolean): Promise<Result<void>> {
		const result = await this.#deps.sidecar.request("setAutoApproveEdits", {
			sessionId: id,
			enabled,
		});
		return result.ok ? ok(undefined) : result;
	}

	/** Sets the option through the sidecar and stores the new choice in the chat's `acpConfig`. */
	setAcpOption(_id: SessionId, _optionId: string, _value: string | boolean): Promise<Result<void>> {
		return notImplemented("AGENT-17");
	}

	/** The goal bar's Save. An empty objective is refused with "Enter a goal first." */
	setGoal(_id: SessionId, _objective: string): Promise<Result<void>> {
		return notImplemented("COMP-10");
	}

	changeGoal(_id: SessionId, _action: "pause" | "resume" | "clear"): Promise<Result<void>> {
		return notImplemented("COMP-10");
	}
}
