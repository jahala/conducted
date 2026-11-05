/**
 * @feature CHAT-01 Sessions service: chats, sending, cancelling, interactions
 * Owns: the list of chats per workspace, each chat's live state and stored events in memory, the
 * send and cancel paths to the sidecar, the open question or approval, and the chat view model.
 * Behaviour: sessions-and-chats.md ("What happens when you send a message", "While the agent is
 * working", "Questions, approvals and plans"), sessions.md 2, 5, 6, services-map.md 2.3.3 (session
 * operations), 2.4.2 (status values), ui-map.md 3.2 and 3.3.
 * Must handle: a send returns when the turn starts, not when it ends; the reply streams in as
 * events; the status is only idle or working and "idle" never shows before the last event of the
 * turn is stored; a message sent while working goes to the queue or steers, by the user's default
 * (`chooseDelivery`); the first message of a chat carries `firstMessage: true`; the agent's own
 * session id is saved when the sidecar reports it and sent back as `resume` afterwards; a failed
 * send leaves the draft and shows the error, nothing is stored; cancel marks the chat
 * "cancelling" until the sidecar says idle, withdraws the open interaction, and pauses the queue;
 * a new message or a cancel withdraws the open interaction; only one interaction is open per
 * chat, a new request replaces it; a late live state or event for a chat the user closed or
 * deleted is dropped; closing the last open chat of a workspace keeps the workspace; unread is
 * set when an agent event arrives for a chat nobody is looking at and cleared when it is shown;
 * only the newest answer wins when two config updates cross.
 * Our design choice: the sidecar writes the `user_message` event, so the message appears in the
 * chat when that event is stored; until then the view shows it as "sending". Cancel pauses the
 * queue. `sendInstruction` is how git and GitHub actions reach the agent.
 * Test first: chooseDelivery("steer") while working calls the sidecar with delivery "steer".
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

export interface SessionsServiceDeps {
	db: Database;
	repositories: () => Repositories;
	sidecar: Pick<SidecarClient, "request" | "notify">;
	composer: Pick<ComposerService, "materializeForSend" | "clearDraft">;
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
	start(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("CHAT-01");
	}

	/** Backs `Actions.sessions.create`. */
	create(_workspaceId: WorkspaceId, _config: SessionConfig): Promise<Result<Session>> {
		return notImplemented("CHAT-01");
	}

	/** Backs `Actions.sessions.close`: hides the tab, keeps the chat in history. */
	close(_id: SessionId): Promise<Result<void>> {
		return notImplemented("CHAT-01");
	}

	reopen(_id: SessionId): Promise<Result<void>> {
		return notImplemented("CHAT-01");
	}

	rename(_id: SessionId, _title: string): Promise<Result<void>> {
		return notImplemented("CHAT-01");
	}

	/** Loads the stored events of a chat the first time it is shown, and warms the agent. */
	open(_id: SessionId): Promise<Result<void>> {
		return notImplemented("CHAT-01");
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
		_sessionId: SessionId,
		_idx: number,
		_event: SessionEvent,
		_receivedAt: number,
	): void {
		notImplemented("DATA-04");
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
	draftOf(_sessionId: SessionId): Draft {
		return notImplemented("COMP-01");
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
