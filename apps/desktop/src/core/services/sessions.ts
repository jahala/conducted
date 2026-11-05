/**
 * @feature CHAT-01 Sessions service: the chat list
 * Owns: the list of chats per workspace, their stored live state and events in memory, and the
 * create, close, reopen, rename, set-title-if-empty, delete and open paths.
 * Behaviour: services-map.md 2.3.3 (session operations), 2.2 (the sessions table), ui-map.md 3.2.
 * Must handle: a closed chat stays in history and leaves the open list; a reopened chat returns to
 * the open list; an empty title is refused; stored events load once, in `idx` order.
 * Our design choice: a chat starts with no title; the title generator fills it only once
 * (`setTitleIfEmpty`), so a name the user typed is never overwritten.
 * Test first: create then close keeps the chat in history and out of the open list.
 *
 * The send, cancel, interaction, progress and unread paths live in the same service but belong to
 * CHAT-02, CHAT-05, CHAT-10, CHAT-13, CHAT-18 and NAV-11. They are placeholders until those
 * features build them, so this header claims only what CHAT-01 builds.
 */
import type {
	Interaction,
	InteractionAnswer,
	InteractionRequest,
	LiveState,
	Progress,
	SessionConfig,
	SessionEvent,
	WorkspaceContext,
} from "@conducted/protocol";
import {
	type AppError,
	appError,
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
import type { Repositories } from "../db/repositories.ts";
import type { ChatView, Session } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import type { ComposerService } from "./composer.ts";
import type { FollowUpQueue } from "./follow-up-queue.ts";
import type { NotificationService } from "./notifications.ts";
import type { StoredEvent } from "./turn-builder.ts";

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
	/** Messages handed to the sidecar whose `user_message` event has not arrived yet. */
	sending: Readonly<Record<string, readonly { messageId: string; text: string; at: number }[]>>;
	openInteractions: Readonly<
		Record<string, { interactionId: InteractionId; interaction: Interaction }>
	>;
	viewingSessionId: SessionId | null;
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
	sidecar: Pick<SidecarClient, "request" | "notify">;
	composer: Pick<ComposerService, "materializeForSend" | "clearDraft" | "draftOf">;
	queue: Pick<FollowUpQueue, "enqueue" | "release" | "pauseOnCancel">;
	notifications: Pick<NotificationService, "onLiveStateChanged">;
	/** Folders and branch facts the sidecar needs to place a chat on disk. */
	workspaceContextOf: (workspaceId: WorkspaceId) => Promise<Result<WorkspaceContext>>;
	/** Default config for a new chat, from settings and the last used model. */
	defaultConfig: (workspaceId: WorkspaceId) => Promise<Result<SessionConfig>>;
	setting: <T>(key: string) => T;
	now: () => number;
	newId: () => string;
}

export class SessionsService implements AgentMessenger {
	readonly store: StoreApi<SessionsState>;
	readonly #deps: SessionsServiceDeps;

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
		this.store.setState((state) => {
			const sessions = { ...state.sessions };
			delete sessions[id];
			const liveStates = { ...state.liveStates };
			delete liveStates[id];
			const events = { ...state.events };
			delete events[id];
			return {
				sessions,
				liveStates,
				events,
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

	/** Loads the stored events of a chat the first time it is shown. */
	async open(id: SessionId): Promise<Result<void>> {
		if (this.store.getState().events[id] !== undefined) return ok(undefined);
		const found = await this.#session(id);
		if (!found.ok) return found;
		const repositories = this.#deps.repositories();
		const last = await repositories.sessionEvents.lastIdx(id);
		if (!last.ok) return last;
		const events: StoredEvent[] = [];
		if (last.value !== null) {
			const stored = await repositories.sessionEvents.listFrom(id, 0, last.value + 1);
			if (!stored.ok) return stored;
			for (const row of stored.value) {
				events.push({
					idx: row.idx,
					event: row.event,
					receivedAt: row.receivedAt,
					revertedAt: row.revertedAt,
				});
			}
		}
		this.store.setState((state) => ({ events: { ...state.events, [id]: events } }));
		return ok(undefined);
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

	/** Backs `Actions.sessions.send`. */
	send(
		_id: SessionId,
		_text: string,
		_attachmentPaths: readonly string[],
		_delivery: "auto" | "queue" | "steer",
	): Promise<Result<void>> {
		return notImplemented("CHAT-02");
	}

	/** Implements `AgentMessenger`: the path for "Commit and push", "Create PR", "Fix errors" and similar. */
	sendInstruction(
		_workspaceId: WorkspaceId,
		_text: string,
		_options?: { newChat?: boolean; config?: Partial<SessionConfig> },
	): Promise<Result<SessionId>> {
		return notImplemented("CHAT-02");
	}

	/** Backs `Actions.sessions.cancel`. */
	cancel(_id: SessionId): Promise<Result<void>> {
		return notImplemented("CHAT-05");
	}

	/** Backs `Actions.sessions.answer`. A superseded answer is not an error. */
	answer(
		_id: SessionId,
		_interactionId: InteractionId,
		_answer: InteractionAnswer,
	): Promise<Result<void>> {
		return notImplemented("CHAT-10");
	}

	/** Called by the `requestInteraction` handler. Resolves when the user answers or it is withdrawn. */
	requestInteraction(_request: InteractionRequest): Promise<InteractionAnswer> {
		return notImplemented("CHAT-10");
	}

	/** Backs `Actions.sessions.updateConfig`. Some changes apply live, some on the next turn. */
	updateConfig(_id: SessionId, _config: SessionConfig): Promise<Result<void>> {
		return notImplemented("CHAT-02");
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
	createFirstChat(_workspaceId: WorkspaceId, _input: NewWorkspaceInput): Promise<Result<Session>> {
		return notImplemented("WS-01");
	}

	/** Cancels every working chat of a workspace. Used before archive and delete. */
	cancelAll(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("CHAT-05");
	}

	hasWorkingChats(_workspaceId: WorkspaceId): boolean {
		return notImplemented("CHAT-05");
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

	applyLiveState(_sessionId: SessionId, _liveState: LiveState): void {
		notImplemented("CHAT-18");
	}

	applyStoredEvent(
		sessionId: SessionId,
		idx: number,
		event: SessionEvent,
		receivedAt: number,
	): void {
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
			const open = state.openInteractions[sessionId];
			const closeInteraction = event.type === "turn_ended" && open !== undefined;
			if (events === state.events && !closeInteraction) return {};
			if (!closeInteraction) return { events };
			const openInteractions = { ...state.openInteractions };
			delete openInteractions[sessionId];
			return { events, openInteractions };
		});
	}

	setAgentSessionId(_sessionId: SessionId, _agentSessionId: string): Promise<Result<void>> {
		return notImplemented("CHAT-02");
	}

	/** Replaces the chat's progress tracker. An update with no blocks clears it. */
	setProgress(_sessionId: SessionId, _progress: Progress): void {
		notImplemented("CHAT-13");
	}

	/** Closes a turn the sidecar lost: appends `turn_ended` with outcome "interrupted". */
	markInterrupted(_sessionId: SessionId): Promise<Result<void>> {
		return notImplemented("CHAT-18");
	}

	// ---- called by the views ----

	setViewing(_sessionId: SessionId | null): void {
		notImplemented("NAV-11");
	}

	/** Backs `useChat`. Null for an unknown chat. */
	chatView(_sessionId: SessionId): ChatView | null {
		return notImplemented("CHAT-07");
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

	retryFailedSend(_id: SessionId, _messageId: MessageId): Promise<Result<void>> {
		return notImplemented("CHAT-02");
	}

	discardFailedSend(_id: SessionId, _messageId: MessageId): Promise<Result<void>> {
		return notImplemented("CHAT-02");
	}

	retryInNewChat(_id: SessionId, _turnId: TurnId): Promise<Result<Session>> {
		return notImplemented("CHAT-27");
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
