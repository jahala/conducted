/**
 * @feature CHAT-01 Sessions service: the chat list; CHAT-02 Send a message as a new turn;
 * CHAT-05 Cancel a turn; CHAT-13 Progress tracker above the composer; CHAT-16 Fork a chat from a
 * turn; CHAT-17 Copy transcript and search chat history; CHAT-21 Fork a chat to a new workspace;
 * CHAT-26 Start a chat with earlier chats and plans; CHAT-27 Retry a failed turn in a new chat;
 * WS-10 Delete a workspace's chats
 * Owns: the list of chats per workspace, their stored live state and events in memory, the
 * create, close, reopen, rename, set-title-if-empty, delete (which also removes the chat's
 * checkpoint refs) and open paths, deleting every chat of a workspace with its attachment files
 * and drafts, starting a review chat with the review model, sending a user message as a new turn
 * or a steer, running the composition root's first-message hook (WS-04's branch rename),
 * forking a chat up to a checkpointed turn into a new chat of the same or another workspace and
 * resuming its agent at that turn's last message (one turn lookup names the checkpoint for both
 * forks), cancelling a turn:
 * pausing the follow-up queue, withdrawing the open interaction, removing only the pending sends
 * the sidecar dropped, and putting a send that was still in flight back in the composer draft,
 * and starting a failed turn's message again in a new chat of the same workspace, handing a
 * plan to a chosen chat or a new one, copying a chat's concise or full transcript, searching
 * stored message text for the command palette, listing the plans an agent proposed in a workspace,
 * and reading a chat's transcript or one plan for an attachment. A stored user message moves the
 * chat's `lastUserMessageAt` forward in memory too, as the ingest does on the row.
 * Behaviour: services-map.md 2.3.1 (workspace delete deletes its chats), 2.3.3 (session
 * operations), 2.2 (the sessions table), 2.3.4 (composer outbox: restore to draft), ui-map.md
 * 3.2, sessions-and-chats.md "What happens when
 * you send a message" and "While the agent is working" (cancel), sessions.md 6.
 * Must handle: a closed chat stays in history and leaves the open list; a reopened chat returns to
 * the open list; an empty title is refused; stored events load once, in `idx` order; a message is
 * held in memory as pending before the sidecar is asked; a queued row is sent under its own id,
 * so a crash before the row is removed cannot send it twice; an explicit steer for an agent that
 * cannot steer is refused (CHAT-03); a message to an idle chat whose agent program is still being
 * made ready waits in the follow-up queue (`programHeld`, PLAT-28, services-map 5A.8.1); a send that fails keeps its text for
 * Retry and Discard; a chat whose first message cannot be sent is removed, so a retry does not
 * leave an empty chat; a chat config is written only while the stored config is still the one the
 * caller saw, so a late answer cannot overwrite a newer choice; a cancel withdraws the open
 * interaction, takes back the messages the sidecar dropped and returns an in-flight send to the
 * draft, with their attachment rows made drafts again; a sidecar that refuses the cancel changes nothing; cancelAll reaches every working chat
 * of a workspace and no idle one; deleting a workspace's chats moves their attachment files and
 * drafts to the Trash before the rows go, and a missing file is nothing to do; a live state from
 * the sidecar is shown as it arrives and an
 * open interaction in it becomes the chat's card, while a live state without one withdraws the
 * card; the agent's progress tracker replaces the chat's on every update and an empty update
 * clears it, while a new turn clears it too; a chat the sidecar lost gets every open turn closed
 * as `interrupted` in one transaction and an idle live state with no finished notice, while its
 * agent session id stays for resume and a failed live-state write is returned; a review chat uses
 * the review model, fast mode and effort from settings, falls back to the default chat model when
 * no review model is set, and does not start when a review setting cannot be used; a fork copies the chat up to a checkpointed turn into a new chat
 * of the same workspace and refuses a turn with no checkpoint with "Unable to fork chat"; a fork
 * whose copied part holds no agent message to resume at is refused, so two chats never share one
 * agent session; a fork copies the checkpoint refs it keeps under its own ids, so its revert works
 * and survives the origin's deletion. The fork's resume point is stored on its chat row
 * (sessions.fork_resume_native_message_id, migration 0007), so a restart before its first send
 * still resumes at the forked turn; recording that first message clears it.
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
 * there. For CHAT-16, a fork copies the events of the chosen turn and the turns before it into
 * a new chat and resumes the agent at the turn's last message. For CHAT-21, the same copy can be
 * made into a different workspace.
 *
 * The chat view (turns built from stored events) belongs to CHAT-07. Cancel is CHAT-05's, and the
 * interaction paths (answer, requestInteraction) are CHAT-10's. CHAT-18 owns `applyLiveState` and
 * `markInterrupted` here.
 * CHAT-15 owns `markReverted`, which marks the open chat's loaded events from the reverted turn
 * onward so the turn list hides them without a reload.
 * Read state is NAV-11's: mark a chat or a workspace read or unread, and remember the chat on
 * screen for notifications.
 * SIDE-20 owns `applyAgentConfig`, which stores a config the agent changed by itself.
 * AGENT-17 owns `loadAcpConfigOptions`, `setAcpOption` and the `acpConfigOptions` part of the
 * store: an ACP chat's own options beyond the model, fetched and kept per chat.
 * SIDE-21 owns the launch every send and warm carries (`launchFor`: a launch that cannot be built
 * fails the send with its reason and keeps the message for Retry), and `warm`, which starts a
 * chat's agent with its launch and resume token for the ACP options and for a chat the sidecar
 * lost (`sidecar/resume.ts`).
 * COMP-06 owns `restartAgent`: reset the sidecar's session and warm the agent again with resume.
 * AGENT-14 owns `compact`: warm the Codex agent, then ask the sidecar to compact its thread.
 * WS-07 owns `applyLinkedPaths`: a workspace's new linked folders reach every open chat's config,
 * ready for its next message.
 * RC-02 owns the `remoteControl` part of the store: each Claude chat's Remote Control link as the
 * sidecar reports it (`applyRemoteControlState`, from the remoteControlState notification) or
 * answers it (`refreshRemoteControl`, through getSessionStatus; a chat the sidecar does not know is
 * off, and an answer a newer notification overtook is dropped). Turning a Claude chat's switch on
 * through `updateConfig` also warms its agent, so the link comes up without a message.
 * COMP-10 owns the `goals` part of the store and `setGoal`, `changeGoal`, `loadGoal` and
 * `applyGoalChanged`: a Codex chat's goal for the goal bar. Setting, pausing, resuming and
 * clearing send `/goal ...` as a steer, as Conductor does (ui-map.md 3.5), so the chat shows the
 * line and the sidecar turns it into the goal call (AGENT-13). A chat that is not Codex is refused
 * with "Codex goals are not available in this chat." and an empty goal with "Enter a goal first.",
 * both before anything is sent. `loadGoal` reads the goal of a chat whose Codex thread exists,
 * warming its agent first; a chat with no thread has no goal and is not started. A `goalChanged`
 * notification wins over a read still on its way.
 */
import {
	type AcpConfigOption,
	type AgentLaunch,
	type appToSidecarRequests,
	type CodexGoal,
	type Interaction,
	type InteractionAnswer,
	type InteractionRequest,
	idleLiveState,
	type LiveState,
	type Progress,
	type RemoteControlStatus,
	type ResultOf,
	type SessionConfig,
	type SessionEvent,
	type WorkspaceContext,
	zSessionEvent,
} from "@conducted/protocol";
import {
	type AgentKind,
	type AppError,
	appError,
	type CheckpointId,
	createKeyedQueue,
	type EventId,
	err,
	type InteractionId,
	type KeyedQueue,
	type MessageId,
	ok,
	type Result,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Database, FileSystem } from "../../platform/platform.ts";
import type { Draft, Loadable, NewWorkspaceInput } from "../api.ts";
import { fireAndForget } from "../async/fire-and-forget.ts";
import { createLatestWins, type LatestWins } from "../async/latest-wins.ts";
import { interruptedTurnEvent } from "../db/repair.ts";
import type { Repositories } from "../db/repositories.ts";
import {
	collectResults,
	executeStatement,
	inTransaction,
	parseJsonColumn,
	selectRows,
	stringifyJson,
} from "../db/row-codec.ts";
import type { StoredSessionEvent } from "../db/session-events.ts";
import { trashIfPresent } from "../fs-helpers.ts";
import { turnCheckpointId } from "../git/refs.ts";
import { parseEffortSetting } from "../lookups.ts";
import type { ChatView, DiagnosticsCapture, PlanEntry, Session } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import type { ComposerService } from "./composer.ts";
import { agentCanSteer, chooseDelivery, type FollowUpQueue } from "./follow-up-queue.ts";
import type { NotificationService } from "./notifications.ts";
import {
	createHistorySearch,
	formatTranscript,
	type HistoryHit,
	plansInEvent,
	planTextInEvent,
	searchHistory,
} from "./transcript.ts";
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
	/** The agent's progress tracker for each chat. A new update replaces it; an empty one clears it. */
	progress: Readonly<Record<string, Progress>>;
	/** Messages held in memory before the sidecar got them, whose `user_message` event has not arrived yet. */
	sending: Readonly<Record<string, readonly PendingSend[]>>;
	/** Messages the sidecar did not accept, kept for Retry and Discard. */
	failedSends?: Readonly<Record<string, readonly FailedSend[]>>;
	/** An ACP chat's own options beyond the model, as the agent last reported them. */
	acpConfigOptions?: Readonly<Record<string, Loadable<AcpConfigOption[]>>>;
	/** A Claude chat's Remote Control link, as the sidecar last reported it (RC-02). */
	remoteControl?: Readonly<Record<string, RemoteControlStatus>>;
	/** A Codex chat's goal, as the sidecar last reported it; null when it has none (COMP-10). */
	goals?: Readonly<Record<string, CodexGoal | null>>;
	openInteractions: Readonly<
		Record<
			string,
			{
				interactionId: InteractionId;
				interaction: Interaction;
				/** When Codex stops waiting, in milliseconds since the epoch. Null: no limit. */
				expiresAt: number | null;
				/** The agent stopped waiting before the user answered. */
				timedOut: boolean;
			}
		>
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

/** Conductor's messages for a goal it cannot set (ui-map.md 3.5, the toast inventory). */
const GOAL_UNAVAILABLE = "Codex goals are not available in this chat.";
const GOAL_EMPTY = "Enter a goal first.";

/** A config write is tried this many times before its failure is reported. */
const CONFIG_WRITE_ATTEMPTS = 3;

/** The config of a review chat: the review model, fast mode and effort, on the default config. */
function reviewConfigFrom(
	base: SessionConfig,
	setting: <T>(key: string) => T,
): Result<SessionConfig> {
	const model = setting<string>("review_model").trim();
	const effortKey =
		base.agent === "codex"
			? "review_codex_thinking_level"
			: base.agent === "claude"
				? "review_claude_effort_level"
				: null;
	let effort = base.effort;
	if (effortKey !== null) {
		const effortSetting = setting<string>(effortKey).trim();
		if (effortSetting.length > 0) {
			const parsed = parseEffortSetting(effortKey, effortSetting);
			if (!parsed.ok) return parsed;
			effort = parsed.value;
		}
	}
	return ok({
		...base,
		model: model.length > 0 ? model : base.model,
		effort,
		fastMode: setting<boolean>("review_fast_mode"),
	});
}

/**
 * True when a chat is blocked on the user right now: it has a card the user must answer, either in
 * the app's own map or in the live state the sidecar sent.
 */
export function sessionWaitsForUser(
	state: Pick<SessionsState, "openInteractions" | "liveStates">,
	sessionId: SessionId,
): boolean {
	return (
		state.openInteractions[sessionId] !== undefined ||
		state.liveStates[sessionId]?.openInteraction !== undefined
	);
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
	/** Moves attachment files to the Trash when a chat is deleted. */
	fs: Pick<FileSystem, "exists" | "trash">;
	sidecar: Pick<SidecarClient, "request" | "notify">;
	composer: Pick<
		ComposerService,
		"materializeForSend" | "clearDraft" | "draftOf" | "loadDraft" | "saveDraft"
	>;
	queue: Pick<FollowUpQueue, "enqueue" | "release" | "pauseOnCancel" | "store">;
	notifications: Pick<NotificationService, "onLiveStateChanged">;
	/**
	 * True while the agent's managed program is still being made ready and the user chose no
	 * program of their own (PLAT-28, services-map 5A.8.1). A message to an idle chat then waits in
	 * the follow-up queue instead of going to the sidecar.
	 */
	programHeld?: (agent: AgentKind) => boolean;
	/**
	 * How to start the chat's agent, from the composition root. A send fails with a clear error
	 * when it is missing: building a launch here would drop the provider keys and the program path.
	 * It reads the saved environment and keys from the database and the Keychain, and a read that
	 * fails is an error value the send or warm hands on.
	 */
	launchFor?: (session: Session) => Promise<Result<AgentLaunch>>;
	/**
	 * Removes a chat's checkpoint refs before its row is deleted (DATA-06). The composition root
	 * supplies it; a harness without it still deletes chats and leaves the refs alone.
	 */
	pruneCheckpoints?: (sessionId: SessionId, workspaceId: WorkspaceId) => Promise<Result<number>>;
	/**
	 * Copies checkpoint refs under new ids, for a fork (CHAT-16). Each pair is a checkpoint id the
	 * origin's events name and the fork's own id for the same turn and phase. The composition root
	 * supplies it; a fork with checkpoints to copy and no way to copy them is refused.
	 */
	copyCheckpoints?: (
		workspaceId: WorkspaceId,
		pairs: readonly (readonly [from: string, to: string])[],
	) => Promise<Result<number>>;
	/** Runs after a chat's first message is accepted. WS-04 uses it to rename the branch. */
	onFirstMessage?: (session: Session, text: string) => Promise<void>;
	/** Reports work that runs beside the send, such as the first-message branch rename. */
	log?: (level: "warn" | "info", message: string) => void;
	/** Folders and branch facts the sidecar needs to place a chat on disk. */
	workspaceContextOf: (workspaceId: WorkspaceId) => Promise<Result<WorkspaceContext>>;
	/** Default config for a new chat, from settings and the last used model. */
	defaultConfig: (workspaceId: WorkspaceId) => Promise<Result<SessionConfig>>;
	setting: <T>(key: string) => T;
	/** Writes text to the clipboard for a copied transcript. The composition root passes the SystemService's one copy path. */
	copyText?: (text: string) => Promise<Result<void>>;
	/** APP-03: captures the diagnostics facts for a report. */
	captureDiagnostics?: () => Promise<Result<DiagnosticsCapture>>;
	/** APP-03: writes the redacted report and returns the file's path. */
	writeDiagnosticsReport?: (capture: DiagnosticsCapture) => Promise<Result<string>>;
	now: () => number;
	newId: () => string;
}

/** The sidecar's usage answer for one chat (SIDE-17, CHAT-28). */
export type ContextUsageAnswer = ResultOf<(typeof appToSidecarRequests)["getContextUsage"]>;

/** The message that carries the diagnostics report into the new chat. Our words. */
const DIAGNOSTICS_CHAT_PROMPT = "Here is my Conducted diagnostics report.";

/** Every stored plan call of a workspace's chats, newest event first (CHAT-26). */
const WORKSPACE_PLANS_SQL = `SELECT e.session_id AS session_id, e.content AS content,
  e.received_at AS received_at, s.title AS session_title
FROM session_events e
JOIN sessions s ON s.id = e.session_id
WHERE s.workspace_id = $1
  AND e.type = 'agent'
  AND e.reverted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM json_each(e.content, '$.message.items') item
    WHERE json_extract(item.value, '$.kind') = 'tool_call'
      AND json_extract(item.value, '$.tool') = 'exit_plan_mode')
ORDER BY e.received_at DESC`;

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
	/**
	 * Every config write for one chat, from the composer or from the agent, runs here in arrival
	 * order. The agent's store and the composer's compare-and-set never interleave.
	 */
	readonly #configWrites: KeyedQueue<SessionId> = createKeyedQueue<SessionId>();
	/** The newest option-list request per chat. An older answer never changes the store. */
	readonly #acpOptionRequests: LatestWins<string> = createLatestWins<string>();
	readonly #remoteControlRequests: LatestWins<string> = createLatestWins<string>();
	readonly #goalRequests: LatestWins<string> = createLatestWins<string>();
	/** The stored-history search over the event log. */
	readonly #historySearch: (query: string, limit: number) => Promise<Result<HistoryHit[]>>;
	/** Loads of stored events in progress, with the events that arrived meanwhile. */
	readonly #opening = new Map<
		string,
		{ promise: Promise<Result<void>>; buffered: StoredEvent[] }
	>();

	constructor(deps: SessionsServiceDeps) {
		this.#deps = deps;
		this.#historySearch = createHistorySearch(deps.db);
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
			acpConfigOptions: {},
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

	/**
	 * Creates a chat and sends its first message. When the send fails the new chat is deleted, so a
	 * retry does not leave an empty chat in the workspace.
	 */
	async #createAndSend(
		workspaceId: WorkspaceId,
		config: SessionConfig,
		text: string,
		attachmentPaths: readonly string[],
	): Promise<Result<Session>> {
		const created = await this.create(workspaceId, config);
		if (!created.ok) return created;
		const sent = await this.send(created.value.id, text, attachmentPaths, "auto");
		if (sent.ok) return created;
		const removed = await this.delete(created.value.id);
		if (!removed.ok) return err(appError(sent.error.code, sent.error.message, removed.error));
		return sent;
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
		// Prune first: a git failure leaves the chat in place so the user can retry, rather than
		// losing a chat whose refs could not be removed.
		const pruned = await this.#deps.pruneCheckpoints?.(id, found.value.workspaceId);
		if (pruned !== undefined && !pruned.ok) return err(pruned.error);
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

	/**
	 * Materialises attachments, then hands the message to the sidecar. A queued row passes its own
	 * id as `messageId`; any other send gets a fresh one.
	 */
	async #prepareAndSend(
		session: Session,
		text: string,
		attachmentPaths: string[],
		delivery: "new_turn" | "steer",
		cancelVersion: number,
		messageId: MessageId | undefined,
	): Promise<Result<void>> {
		const workspace = await this.#workspaceContext(session.workspaceId);
		if (!workspace.ok) return workspace;
		const resolvedMessageId = messageId ?? (this.#deps.newId() as MessageId);
		let paths = attachmentPaths;
		if (paths.length > 0) {
			const materialized = await this.#deps.composer.materializeForSend(
				session.id,
				workspace.value.workspacePath,
				resolvedMessageId,
			);
			if (!materialized.ok) return materialized;
			paths = materialized.value;
		}
		return this.#submit(
			session,
			{
				messageId: resolvedMessageId,
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
		const launch = await launchFor(session);

		if (this.#cancelVersionOf(session.id) !== cancelVersion) {
			await this.#restoreDroppedToDraft(session.id, [pending]);
			return err(appError("cancelled", "The message was cancelled before it was sent."));
		}
		// A launch that cannot be built (a Keychain value gone, a list that cannot be read) keeps
		// the message for Retry, with the reason, as a refused send does.
		if (!launch.ok) {
			this.#addFailed(session.id, { ...pending, error: launch.error });
			return launch;
		}

		const firstMessage = last.value === null;
		this.#setSending(session.id, pending);
		const resume = this.#resumeFor(session);
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
			launch: launch.value,
			...(resume === null ? {} : { resume }),
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
		// The sidecar's session for a forked chat now exists, so the resume point is used up. The
		// stored copy is cleared when the ingest records this message (recordUserMessage).
		if (session.forkResumeNativeMessageId !== null) {
			this.#storeForkResume(session.id, null);
		}
		if (firstMessage && this.#deps.onFirstMessage !== undefined) {
			const onFirstMessage = this.#deps.onFirstMessage;
			fireAndForget(
				() => onFirstMessage(session, pending.text),
				(error) => this.#deps.log?.("warn", `The first-message step failed: ${String(error)}`),
			);
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
	 * message or steers it, following the user's default or the requested mode. A steer asked for
	 * by name is refused for an agent that cannot steer (CHAT-03). The follow-up queue passes the
	 * row's id as `messageId`, so the stored user message carries the row's id (CHAT-03).
	 */
	async send(
		id: SessionId,
		text: string,
		attachmentPaths: readonly string[],
		delivery: "auto" | "queue" | "steer",
		messageId?: MessageId,
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

		if (decision === "steer_unsupported") {
			return err(
				appError(
					"steer_unsupported",
					"This agent cannot be steered. Send the message as a follow-up instead.",
				),
			);
		}
		// A row the follow-up queue delivers (it carries `messageId`) passed the queue's own hold.
		const held =
			decision === "send_now" &&
			messageId === undefined &&
			this.#deps.programHeld?.(session.config.agent) === true;
		if (decision === "queue" || held) {
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
			messageId,
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

	/**
	 * Puts the messages the sidecar dropped before delivering them back in the composer draft. Their
	 * attachment rows, marked sent when the message was prepared, become drafts again (COMP-07), so
	 * the next send takes them as the draft's own.
	 */
	async #restoreDroppedToDraft(
		sessionId: SessionId,
		dropped: readonly PendingSend[],
	): Promise<Result<void>> {
		if (dropped.length === 0) return ok(undefined);
		const attachments = this.#deps.repositories().attachments;
		for (const entry of dropped) {
			const restored = await attachments.restoreToDraft(entry.messageId);
			if (!restored.ok) return restored;
		}
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

	/**
	 * Backs the `interactionClosed` notification. A timed-out request keeps its card, marked as
	 * timed out, and the agent's pending request settles as withdrawn. A delivery failure leaves
	 * the card in place so the user can answer again.
	 */
	interactionClosed(params: {
		sessionId: SessionId;
		interactionId: InteractionId;
		reason: "timed_out" | "delivery_failed";
	}): void {
		const open = this.store.getState().openInteractions[params.sessionId];
		if (open === undefined || open.interactionId !== params.interactionId) return;
		if (params.reason !== "timed_out") return;
		this.store.setState((state) => ({
			openInteractions: {
				...state.openInteractions,
				[params.sessionId]: { ...open, timedOut: true },
			},
		}));
		this.#resolveInteraction(params.interactionId, { kind: "withdrawn" });
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
					expiresAt: request.expiresAt ?? null,
					timedOut: false,
				},
			},
		}));
	}

	/** Answers the sidecar's open request and removes the card. A stale id is ignored. */
	#settleInteraction(interactionId: InteractionId, answer: InteractionAnswer): void {
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
		this.#resolveInteraction(interactionId, answer);
	}

	/** Resolves the sidecar's pending request without touching the card on screen. */
	#resolveInteraction(interactionId: InteractionId, answer: InteractionAnswer): void {
		const resolve = this.#interactionResolvers.get(interactionId);
		this.#interactionResolvers.delete(interactionId);
		this.#interactionPromises.delete(interactionId);
		resolve?.(answer);
	}

	/**
	 * Backs `Actions.sessions.updateConfig`. Some changes apply live, some on the next turn.
	 * The write is a compare-and-set on the config text: a late update cannot overwrite a newer
	 * choice. When it loses, the newer stored config is adopted instead. It runs on the same
	 * per-chat queue as the agent's config changes, so an older agent notification that arrived
	 * first cannot land after the user's newer choice.
	 */
	async updateConfig(id: SessionId, config: SessionConfig): Promise<Result<void>> {
		const before = this.store.getState().sessions[id]?.config;
		const written = await this.#configWrites.run(id, () => this.#persistConfig(id, config, true));
		if (!written.ok) return written;
		// RC-02: Remote Control needs the agent running, so the switch starts it at once.
		const turnedOn =
			config.agent === "claude" && config.remoteControl === true && before?.remoteControl !== true;
		return turnedOn ? this.warm(id) : written;
	}

	/** Shows a chat's Remote Control link as the sidecar reports it (RC-02). */
	applyRemoteControlState(sessionId: SessionId, status: RemoteControlStatus): void {
		// A notification is newer than any status answer still on its way.
		this.#remoteControlRequests.invalidate(sessionId);
		this.#setRemoteControl(sessionId, status);
	}

	/**
	 * Asks the sidecar for a chat's Remote Control link, for a chat shown after the app reloaded. A
	 * chat the sidecar does not know has none running.
	 */
	/**
	 * Asks the sidecar for a chat's context and plan usage and its signed-in account, for the
	 * context card (SIDE-17, CHAT-28). Read on demand; nothing is kept here.
	 */
	contextUsage(sessionId: SessionId): Promise<Result<ContextUsageAnswer>> {
		return this.#deps.sidecar.request("getContextUsage", { sessionId });
	}

	async refreshRemoteControl(sessionId: SessionId): Promise<Result<void>> {
		const ticket = this.#remoteControlRequests.begin(sessionId);
		const status = await this.#deps.sidecar.request("getSessionStatus", { sessionId });
		if (!this.#remoteControlRequests.isLatest(ticket)) return status.ok ? ok(undefined) : status;
		this.#remoteControlRequests.settle(ticket);
		if (!status.ok) return status;
		this.#setRemoteControl(sessionId, status.value.remoteControl ?? { state: "off" });
		return ok(undefined);
	}

	#setRemoteControl(sessionId: SessionId, status: RemoteControlStatus): void {
		this.store.setState((state) => ({
			remoteControl: { ...(state.remoteControl ?? {}), [sessionId]: status },
		}));
	}

	/**
	 * WS-07: gives every chat open in a workspace the workspace's new linked folders. The config
	 * is stored now and travels with the chat's next message (D032), so no agent is restarted for
	 * a folder it will only need at the next turn.
	 */
	async applyLinkedPaths(
		workspaceId: WorkspaceId,
		paths: readonly string[],
	): Promise<Result<void>> {
		for (const id of [...(this.store.getState().byWorkspace[workspaceId] ?? [])]) {
			const current = this.store.getState().sessions[id];
			if (current === undefined) continue;
			const config: SessionConfig = {
				...current.config,
				additionalDirectories: [...paths],
			};
			if (sameConfig(current.config, config)) continue;
			const written = await this.#configWrites.run(id, () =>
				this.#persistConfig(id, config, false),
			);
			if (!written.ok) return written;
		}
		return ok(undefined);
	}

	#persistConfig(
		id: SessionId,
		config: SessionConfig,
		notifySidecar: boolean,
	): Promise<Result<void>> {
		return (async () => {
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
			if (!notifySidecar) return ok(undefined);
			const applied = await this.#deps.sidecar.request("updateConfig", {
				sessionId: id,
				config,
			});
			return applied.ok ? ok(undefined) : applied;
		})();
	}

	/**
	 * Backs `Actions.sessions.startFromPlan`: the chosen chat, or a new chat in the same workspace
	 * when `target` is null, carries out the plan. A new chat starts with plan mode off, because
	 * the plan is already written and hand-off means implementation. A target in another workspace
	 * is refused.
	 */
	async startFromPlan(
		id: SessionId,
		planText: string,
		target: SessionId | null,
	): Promise<Result<Session>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const origin = found.value;
		const text = planText.trim();
		if (text.length === 0) {
			return err(appError("chat_plan_empty", "The plan has no text to send."));
		}
		if (target === null) {
			const base = await this.#deps.defaultConfig(origin.workspaceId);
			if (!base.ok) return base;
			return this.#createAndSend(origin.workspaceId, { ...base.value, planMode: false }, text, []);
		}
		const targetSession = await this.#session(target);
		if (!targetSession.ok) return targetSession;
		if (targetSession.value.workspaceId !== origin.workspaceId) {
			return err(appError("chat_plan_target_invalid", "That chat belongs to another workspace."));
		}
		const sent = await this.send(target, text, [], "auto");
		return sent.ok ? ok(targetSession.value) : sent;
	}

	/** Backs `Actions.app.createDiagnosticsChat`: saves the redacted report and starts a chat with it attached. */
	async createDiagnosticsChat(workspaceId: WorkspaceId): Promise<Result<void>> {
		const capture = this.#deps.captureDiagnostics;
		const write = this.#deps.writeDiagnosticsReport;
		if (capture === undefined || write === undefined) {
			return err(
				appError(
					"diagnostics_unavailable",
					"The diagnostics report cannot be written because the report writer was not provided.",
				),
			);
		}
		const captured = await capture();
		if (!captured.ok) return captured;
		const written = await write(captured.value);
		if (!written.ok) return written;
		const config = await this.#deps.defaultConfig(workspaceId);
		if (!config.ok) return config;
		const created = await this.create(workspaceId, config.value);
		if (!created.ok) return created;
		// A new chat has no draft, so the attachment path is put there for materializeForSend.
		this.#deps.composer.saveDraft(created.value.id, {
			text: "",
			attachmentPaths: [written.value],
		});
		const sent = await this.send(
			created.value.id,
			DIAGNOSTICS_CHAT_PROMPT,
			[written.value],
			"auto",
		);
		if (sent.ok) return ok(undefined);
		const removed = await this.delete(created.value.id);
		if (!removed.ok) return err(appError(sent.error.code, sent.error.message, removed.error));
		return sent;
	}

	/**
	 * Backs `Actions.sessions.copyTranscript`: loads the chat's stored events if needed, builds its
	 * turns and writes the concise or full text to the clipboard.
	 */
	async copyTranscript(id: SessionId, detail: "concise" | "full"): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const opened = await this.open(id);
		if (!opened.ok) return opened;
		const state = this.store.getState();
		const liveState = state.liveStates[id] ?? idleLiveState;
		const pending = (state.sending[id] ?? []).map((send) => ({
			...send,
			messageId: send.messageId as MessageId,
		}));
		const text = formatTranscript(buildTurns(state.events[id] ?? [], liveState, pending), detail);
		const copyText = this.#deps.copyText;
		if (copyText === undefined) {
			return err(appError("chat_copy_unavailable", "Copying is not available right now."));
		}
		return copyText(text);
	}

	/**
	 * Reads a chat's title and concise transcript, for attaching it to another chat (CHAT-26).
	 */
	async transcriptOf(id: SessionId): Promise<Result<{ title: string | null; text: string }>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const opened = await this.open(id);
		if (!opened.ok) return opened;
		const state = this.store.getState();
		const liveState = state.liveStates[id] ?? idleLiveState;
		const pending = (state.sending[id] ?? []).map((send) => ({
			...send,
			messageId: send.messageId as MessageId,
		}));
		const text = formatTranscript(
			buildTurns(state.events[id] ?? [], liveState, pending),
			"concise",
		);
		return ok({ title: found.value.title, text });
	}

	/** Reads one plan an agent proposed in a chat, for attaching it (CHAT-26). */
	async planFor(id: SessionId, turnId: TurnId): Promise<Result<{ title: string; text: string }>> {
		const opened = await this.open(id);
		if (!opened.ok) return opened;
		const state = this.store.getState();
		const events = (state.events[id] ?? []).filter(
			(entry) => entry.event.turnId === turnId && entry.revertedAt === null,
		);
		for (const stored of events) {
			const text = planTextInEvent(stored.event, turnId);
			if (text === null) continue;
			const plan = plansInEvent(stored.event, id, null, stored.receivedAt, false)[0];
			return ok({ title: plan?.title ?? "Plan", text });
		}
		return err(appError("chat_plan_unknown", "That plan is no longer in this chat."));
	}

	/** Lists the plans agents proposed in a workspace, newest first (CHAT-26). */
	async listPlans(workspaceId: WorkspaceId): Promise<Result<PlanEntry[]>> {
		const rows = await selectRows<{
			session_id: SessionId;
			content: string;
			received_at: number;
			session_title: string | null;
		}>(this.#deps.db, WORKSPACE_PLANS_SQL, [workspaceId], "Reading workspace plans");
		if (!rows.ok) return rows;
		const events = collectResults(
			rows.value.map((row) =>
				parseJsonColumn(row.content, zSessionEvent, "session_events.content"),
			),
		);
		if (!events.ok) return events;
		const plans: PlanEntry[] = [];
		for (const [index, event] of events.value.entries()) {
			const row = rows.value[index];
			if (row === undefined) continue;
			plans.push(...plansInEvent(event, row.session_id, row.session_title, row.received_at, false));
		}
		return ok(plans);
	}

	/** Backs chat history search, newest matching stored text first. */
	searchHistory(query: string, limit: number): Promise<Result<HistoryHit[]>> {
		return searchHistory({ search: this.#historySearch }, query, limit);
	}

	// ---- the port the workspace service uses (WorkspaceSessionsPort) ----

	/** Creates the first chat of a new workspace and sends the prompt, unless the prompt is empty. */
	async createFirstChat(
		workspaceId: WorkspaceId,
		input: NewWorkspaceInput,
	): Promise<Result<Session>> {
		if (input.prompt.trim() === "" && input.attachmentPaths.length === 0) {
			return this.create(workspaceId, input.config);
		}
		return this.#createAndSend(workspaceId, input.config, input.prompt, input.attachmentPaths);
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

	/**
	 * Backs `Actions.workspaces.markRead`. Clears every chat of the workspace except the ones that
	 * still wait for the user, so the dot disappears only when nothing needs attention.
	 */
	async markAllRead(workspaceId: WorkspaceId): Promise<Result<void>> {
		const ids = Object.values(this.store.getState().sessions)
			.filter((session) => session.workspaceId === workspaceId && session.unreadCount > 0)
			.map((session) => session.id);
		const cleared: SessionId[] = [];
		for (const id of ids) {
			// Read the state again: an interaction may have opened while an earlier write ran.
			const current = this.store.getState();
			const session = current.sessions[id];
			if (session === undefined || session.unreadCount <= 0) continue;
			if (sessionWaitsForUser(current, id)) continue;
			const result = await this.#deps.repositories().sessions.clearUnread(id);
			if (!result.ok) return result;
			cleared.push(id);
		}
		if (cleared.length === 0) return ok(undefined);

		// A new agent message may have raised the count while the writes above were in flight.
		// The database is the newest word, so take each chat's count from it instead of writing 0.
		const listed = await this.#deps.repositories().sessions.listByWorkspace(workspaceId, {
			includeClosed: true,
		});
		if (!listed.ok) return listed;
		const stored = new Map(listed.value.map((session) => [session.id, session.unreadCount]));
		this.store.setState((current) => {
			const sessions = { ...current.sessions };
			let changed = false;
			for (const id of cleared) {
				const session = sessions[id];
				const unreadCount = stored.get(id);
				if (session === undefined || unreadCount === undefined) continue;
				if (session.unreadCount === unreadCount) continue;
				sessions[id] = { ...session, unreadCount };
				changed = true;
			}
			return changed ? { sessions } : {};
		});
		return ok(undefined);
	}

	/** Deletes the chats, events and attachment files of a workspace that is being removed. */
	async deleteAll(workspaceId: WorkspaceId): Promise<Result<void>> {
		const listed = await this.#deps.repositories().sessions.listByWorkspace(workspaceId, {
			includeClosed: true,
		});
		if (!listed.ok) return listed;
		for (const session of listed.value) {
			const attachments = await this.#deps.repositories().attachments.listBySession(session.id);
			if (!attachments.ok) return attachments;
			for (const attachment of attachments.value) {
				const trashed = await trashIfPresent(this.#deps.fs, attachment.path);
				if (!trashed.ok) return trashed;
			}
			const draft = await this.#deps.composer.clearDraft(session.id);
			if (!draft.ok) return draft;
			const removed = await this.delete(session.id);
			if (!removed.ok) return removed;
		}
		return ok(undefined);
	}

	/** Starts a chat with the review model and sends `text`. Used by the AI review. */
	async startReviewChat(workspaceId: WorkspaceId, text: string): Promise<Result<Session>> {
		const base = await this.#deps.defaultConfig(workspaceId);
		if (!base.ok) return base;
		const config = reviewConfigFrom(base.value, this.#deps.setting);
		if (!config.ok) return config;
		return this.#createAndSend(workspaceId, config.value, text, []);
	}

	// ---- called by the sidecar side (core/sidecar) ----

	/**
	 * Shows the sidecar's live state. A new state replaces the one before it. An interaction the
	 * new state no longer carries is settled as withdrawn, so a stale card never stays on screen.
	 */
	async applyLiveState(
		sessionId: SessionId,
		liveState: LiveState,
		options: { notify?: boolean } = {},
	): Promise<Result<void>> {
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
				const same = previous?.interactionId === nextOpen.interactionId;
				openInteractions[sessionId] = {
					interactionId: nextOpen.interactionId,
					interaction: nextOpen.interaction,
					expiresAt: same ? (previous?.expiresAt ?? null) : null,
					timedOut: same ? (previous?.timedOut ?? false) : false,
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
		if (options.notify !== false) this.#deps.notifications.onLiveStateChanged(sessionId);
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
			const loaded = state.events[sessionId] ?? [];
			const duplicate = loaded.some((stored) => stored.idx === idx);
			const events = duplicate
				? state.events
				: {
						...state.events,
						[sessionId]: [...loaded, { idx, event, receivedAt, revertedAt: null }],
					};

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
			const clearProgress =
				event.type === "user_message" &&
				event.delivery === "new_turn" &&
				state.progress[sessionId] !== undefined;
			// The ingest stores the user message's time on the row; the list in memory follows it, so
			// a chat's last user message is current without a reload (CHAT-26 lists chats by it).
			const session = state.sessions[sessionId];
			const datedSession =
				event.type === "user_message" &&
				session !== undefined &&
				(session.lastUserMessageAt ?? Number.NEGATIVE_INFINITY) < event.at
					? { ...session, lastUserMessageAt: event.at }
					: undefined;
			if (
				events === state.events &&
				!closeInteraction &&
				!sendingChanged &&
				!clearProgress &&
				datedSession === undefined
			) {
				return {};
			}

			const next: Partial<SessionsState> = {};
			if (events !== state.events) next.events = events;
			if (datedSession !== undefined) {
				next.sessions = { ...state.sessions, [sessionId]: datedSession };
			}
			if (sendingChanged) {
				next.sending = { ...state.sending, [sessionId]: settled ?? [] };
			}
			if (closeInteraction) {
				const openInteractions = { ...state.openInteractions };
				delete openInteractions[sessionId];
				next.openInteractions = openInteractions;
			}
			if (clearProgress) {
				const progress = { ...state.progress };
				delete progress[sessionId];
				next.progress = progress;
			}
			return next;
		});
		if (closedInteractionId !== null) {
			this.#settleInteraction(closedInteractionId, { kind: "withdrawn" });
		}
	}

	/**
	 * Reflects a completed revert in the open chat's store: every event from the turn's user
	 * message onward is marked reverted, exactly as the database write did. The turn list then
	 * drops those turns without reloading the chat. Events are kept, never removed.
	 */
	markReverted(sessionId: SessionId, turnId: TurnId, at: number): void {
		this.store.setState((state) => {
			const loaded = state.events[sessionId];
			if (loaded === undefined) return {};
			const first = loaded.find(
				(row) => row.event.turnId === turnId && row.event.type === "user_message",
			);
			if (first === undefined) return {};
			const events = loaded.map((row) =>
				row.idx >= first.idx && row.revertedAt === null ? { ...row, revertedAt: at } : row,
			);
			return { events: { ...state.events, [sessionId]: events } };
		});
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

	/**
	 * Stores a config the agent changed by itself, such as entering plan mode (SIDE-20). A failed
	 * write is retried through this same writer before it is reported. It shares the per-chat queue
	 * with the composer, so an older agent notification cannot land after a newer user choice.
	 */
	async applyAgentConfig(sessionId: SessionId, config: SessionConfig): Promise<Result<void>> {
		return this.#configWrites.run(sessionId, async () => {
			let written = await this.#deps.repositories().sessions.setConfig(sessionId, config);
			for (let attempt = 1; attempt < CONFIG_WRITE_ATTEMPTS && !written.ok; attempt += 1) {
				// Yield first, so a busy database gets its chance to finish.
				await new Promise((resolve) => setTimeout(resolve, 0));
				written = await this.#deps.repositories().sessions.setConfig(sessionId, config);
			}
			if (!written.ok) return written;
			this.#setConfig(sessionId, config, this.#deps.now());
			return ok(undefined);
		});
	}

	/** Replaces the chat's progress tracker. An update with no blocks clears it. */
	setProgress(sessionId: SessionId, progress: Progress): void {
		this.store.setState((state) => {
			const current = state.progress[sessionId];
			if (progress.blocks.length === 0) {
				if (current === undefined) return {};
				const cleared = { ...state.progress };
				delete cleared[sessionId];
				return { progress: cleared };
			}
			return { progress: { ...state.progress, [sessionId]: progress } };
		});
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
		return this.applyLiveState(sessionId, idleLiveState, { notify: false });
	}

	// ---- called by the views ----

	/**
	 * Remembers the chat on screen, so notifications can skip it. Opening a workspace's chat also
	 * clears its unread chats through `markAllRead`; that call belongs to the chat screen.
	 */
	setViewing(sessionId: SessionId | null): void {
		if (this.store.getState().viewingSessionId === sessionId) return;
		this.store.setState({ viewingSessionId: sessionId });
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
							expiresAt: open.expiresAt,
							timedOut: open.timedOut,
						},
			progress: state.progress[sessionId] ?? null,
			goal: state.goals?.[sessionId] ?? null,
		};
	}

	/** Backs `useDraft` through the composer service; kept here so the view model has one source. */
	draftOf(sessionId: SessionId): Draft {
		return this.#deps.composer.draftOf(sessionId);
	}

	// ---- read state, failed sends and agent controls (Actions.sessions)

	/** Backs `Actions.sessions.markRead`. Clears the chat's unread count. */
	async markRead(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const cleared = await this.#deps.repositories().sessions.clearUnread(id);
		if (!cleared.ok) return cleared;
		this.#setUnreadCount(id, 0);
		return ok(undefined);
	}

	/**
	 * Backs `Actions.sessions.markUnread`. A chat that already has unread messages keeps its count,
	 * so toggling the menu item twice never grows the number.
	 */
	async markUnread(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		if (found.value.unreadCount > 0) return ok(undefined);
		const incremented = await this.#deps.repositories().sessions.incrementUnread(id);
		if (!incremented.ok) return incremented;
		this.#setUnreadCount(id, found.value.unreadCount + 1);
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.markUnread`: the workspace's newest chat becomes unread. */
	async markWorkspaceUnread(workspaceId: WorkspaceId): Promise<Result<void>> {
		const newest = this.store.getState().byWorkspace[workspaceId]?.[0];
		if (newest !== undefined) return this.markUnread(newest);
		const listed = await this.#deps.repositories().sessions.listByWorkspace(workspaceId, {
			includeClosed: false,
		});
		if (!listed.ok) return listed;
		const first = [...listed.value].sort(compareNewest)[0];
		return first === undefined ? ok(undefined) : this.markUnread(first.id);
	}

	/** Writes one chat's unread count in the store, keeping the rest of the row unchanged. */
	#setUnreadCount(id: SessionId, unreadCount: number): void {
		this.store.setState((state) => {
			const current = state.sessions[id];
			if (current === undefined || current.unreadCount === unreadCount) return {};
			return { sessions: { ...state.sessions, [id]: { ...current, unreadCount } } };
		});
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

		return this.#createAndSend(
			session.workspaceId,
			session.config,
			message.text,
			message.attachmentPaths,
		);
	}

	/**
	 * Backs `Actions.sessions.forkFrom` (CHAT-16): copies the chat up to and including the chosen
	 * turn into a new chat of the same workspace. The new chat keeps the origin's title, config and
	 * agent session id. Its first send resumes the agent at the turn's last message and asks for a
	 * forked session, so the two chats continue apart. A turn with no checkpoint is refused and
	 * nothing is created, and so is a fork of a chat with an agent session but no agent message to
	 * resume at. The checkpoint refs the copied turns name are copied under the fork's own ids.
	 */
	async forkFrom(id: SessionId, turnId: TurnId): Promise<Result<Session>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		return this.#forkInto(id, turnId, found.value.workspaceId);
	}

	/**
	 * Backs CHAT-21: copies the chat up to and including the chosen turn into a chat of another
	 * workspace. The new chat keeps the origin's title, config and agent session id, and its first
	 * send resumes the agent at the turn's last message with a forked session. The copy rules and
	 * refusals are the same as `forkFrom`.
	 */
	async forkIntoWorkspace(
		id: SessionId,
		turnId: TurnId,
		workspaceId: WorkspaceId,
	): Promise<Result<Session>> {
		return this.#forkInto(id, turnId, workspaceId);
	}

	async #forkInto(
		id: SessionId,
		turnId: TurnId,
		workspaceId: WorkspaceId,
	): Promise<Result<Session>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const origin = found.value;

		const point = await this.#forkPoint(id, turnId);
		if (!point.ok) return point;
		const { stored, cutoff } = point.value;

		// Resume at the last agent message the fork contains, so a turn with no answer of its
		// own still never resumes past a later turn.
		let nativeMessageId: string | undefined;
		for (const row of stored) {
			if (row.idx > cutoff) break;
			if (row.event.type === "agent" && row.event.message.nativeId !== undefined) {
				nativeMessageId = row.event.message.nativeId;
			}
		}
		// Without a message to resume at, the agent would resume the origin's own session, and both
		// chats would write to one agent history.
		if (origin.agentSessionId !== null && nativeMessageId === undefined) {
			return err(
				appError(
					"chat_fork_no_agent_message",
					"Unable to fork chat: the agent has no message to fork from in this turn or before it.",
				),
			);
		}

		const created = await this.create(workspaceId, origin.config);
		if (!created.ok) return created;
		const forked = created.value;
		const discard = async (failure: AppError): Promise<Result<Session>> => {
			const removed = await this.delete(forked.id);
			return removed.ok
				? { ok: false, error: failure }
				: err(appError(failure.code, failure.message, removed.error));
		};

		if (origin.title !== null) {
			const titled = await this.rename(forked.id, origin.title);
			if (!titled.ok) return discard(titled.error);
		}
		if (origin.agentSessionId !== null) {
			const saved = await this.setAgentSessionId(forked.id, origin.agentSessionId);
			if (!saved.ok) return discard(saved.error);
		}

		// The fork gets its own copy of every checkpoint it keeps, named by its own id, so its revert
		// and turn changes find them, and deleting the origin (which prunes the origin's refs) leaves
		// the fork's restore points in place.
		const copiedEvents: StoredSessionEvent[] = [];
		const pairs: [from: string, to: string][] = [];
		for (const row of stored) {
			if (row.idx > cutoff) break;
			const event = row.event;
			if (event.type === "checkpoint" && event.checkpointId !== undefined) {
				const own = turnCheckpointId(forked.id, event.turnId, event.phase);
				pairs.push([event.checkpointId, own]);
				copiedEvents.push({ ...row, event: { ...event, checkpointId: own as CheckpointId } });
			} else {
				copiedEvents.push(row);
			}
		}
		if (pairs.length > 0) {
			const copyCheckpoints = this.#deps.copyCheckpoints;
			if (copyCheckpoints === undefined) {
				return discard(
					appError("chat_fork_unwired", "Unable to fork chat: checkpoints cannot be copied here."),
				);
			}
			const copied = await copyCheckpoints(origin.workspaceId, pairs);
			if (!copied.ok) return discard(copied.error);
		}

		const repository = this.#deps.repositories().sessionEvents;
		for (const row of copiedEvents) {
			const appended = await repository.append(forked.id, row.event, row.receivedAt);
			if (!appended.ok) return discard(appended.error);
		}

		// Stored, so a restart before the fork's first send still resumes at the forked turn.
		if (origin.agentSessionId !== null && nativeMessageId !== undefined) {
			const saved = await this.#deps
				.repositories()
				.sessions.setForkResume(forked.id, nativeMessageId);
			if (!saved.ok) return discard(saved.error);
			this.#storeForkResume(forked.id, nativeMessageId);
		}
		return this.#session(forked.id);
	}

	/**
	 * Backs CHAT-21: the checkpoint a fork of this turn starts from, which the fork to a new
	 * workspace restores there. It is the turn's newest checkpoint: its end checkpoint, or its start
	 * when the turn has none. The refusals are the same as `forkFrom`'s, because both read
	 * `#forkPoint`.
	 */
	async forkCheckpoint(id: SessionId, turnId: TurnId): Promise<Result<CheckpointId>> {
		const point = await this.#forkPoint(id, turnId);
		return point.ok ? ok(point.value.checkpointId) : point;
	}

	/**
	 * The one turn lookup both forks use: the chat's stored events, the last index the fork copies,
	 * and the turn's newest checkpoint. A turn that is not in the chat, or that has no checkpoint,
	 * is refused.
	 */
	async #forkPoint(
		id: SessionId,
		turnId: TurnId,
	): Promise<Result<{ stored: StoredSessionEvent[]; cutoff: number; checkpointId: CheckpointId }>> {
		const stored = await this.#storedEvents(id);
		if (!stored.ok) return stored;
		const turnEvents = stored.value.filter((row) => row.event.turnId === turnId);
		const last = turnEvents[turnEvents.length - 1];
		if (last === undefined) {
			return err(
				appError("chat_fork_turn_unknown", "Unable to fork chat: that turn is no longer here."),
			);
		}
		let checkpointId: CheckpointId | undefined;
		for (const row of turnEvents) {
			if (row.event.type === "checkpoint" && row.event.checkpointId !== undefined) {
				checkpointId = row.event.checkpointId;
			}
		}
		if (checkpointId === undefined) {
			return err(appError("chat_fork_no_checkpoint", "Checkpoint not found for this turn."));
		}
		return ok({ stored: stored.value, cutoff: last.idx, checkpointId });
	}

	/** Every stored event of a chat in log order. */
	async #storedEvents(id: SessionId): Promise<Result<StoredSessionEvent[]>> {
		const repository = this.#deps.repositories().sessionEvents;
		const last = await repository.lastIdx(id);
		if (!last.ok) return last;
		if (last.value === null) return ok([]);
		return repository.listFrom(id, 0, last.value + 1);
	}

	/** /restart: `resetAgent`, then warm the agent again with resume. */
	async restartAgent(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const session = found.value;
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
		const reset = await this.#deps.sidecar.request("resetAgent", { sessionId: id });
		if (!reset.ok) return reset;
		// The sidecar forgets the chat's live state on reset and publishes no idle state, so the
		// app clears it here instead of leaving the chat looking busy.
		this.store.setState((state) => ({
			liveStates: { ...state.liveStates, [id]: idleLiveState },
			cancelling: { ...state.cancelling, [id]: false },
		}));
		const built = await launchFor(session);
		if (!built.ok) return built;
		const resume = this.#resumeFor(session);
		const warm = await this.#deps.sidecar.request("warmAgent", {
			sessionId: id,
			config: session.config,
			workspace: workspace.value,
			launch: built.value,
			...(resume === null ? {} : { resume }),
		});
		if (!warm.ok) return warm;
		return ok(undefined);
	}

	/** /compact: warm the chat's Codex agent, then ask the sidecar to compact its thread. */
	async compact(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		if (found.value.config.agent !== "codex") {
			return err(appError("compact_unsupported", "Only a Codex chat can compact its history."));
		}
		const warmed = await this.#warm(found.value);
		if (!warmed.ok) return warmed;
		const compacted = await this.#deps.sidecar.request("compact", { sessionId: id });
		if (!compacted.ok) return compacted;
		if (!compacted.value.started) {
			return err(
				appError("compact_not_started", "The chat could not start compacting its history."),
			);
		}
		return ok(undefined);
	}

	async setAutoApproveEdits(id: SessionId, enabled: boolean): Promise<Result<void>> {
		const result = await this.#deps.sidecar.request("setAutoApproveEdits", {
			sessionId: id,
			enabled,
		});
		return result.ok ? ok(undefined) : result;
	}

	/**
	 * Fetches an ACP chat's own options beyond the model. The chat's agent is warmed first, so a
	 * saved chat gets its model and options back, and a new chat can show them before its first
	 * reply. Only the newest request changes the store (AGENT-17).
	 */
	async loadAcpConfigOptions(id: SessionId): Promise<Result<AcpConfigOption[]>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const session = found.value;
		if (session.config.agent !== "acp") {
			this.#setAcpOptions(id, { state: "ready", data: [] });
			return ok([]);
		}

		const ticket = this.#acpOptionRequests.begin(id);
		this.#setAcpOptions(id, { state: "loading" });
		const warmed = await this.#warm(session);
		if (!this.#acpOptionRequests.isLatest(ticket)) {
			return warmed.ok ? ok([]) : warmed;
		}
		if (!warmed.ok) {
			this.#acpOptionRequests.settle(ticket);
			this.#setAcpOptions(id, { state: "error", error: warmed.error });
			return warmed;
		}

		const listed = await this.#deps.sidecar.request("listAcpConfigOptions", { sessionId: id });
		if (!this.#acpOptionRequests.isLatest(ticket)) {
			return listed.ok ? ok(listed.value.options) : listed;
		}
		this.#acpOptionRequests.settle(ticket);
		if (!listed.ok) {
			this.#setAcpOptions(id, { state: "error", error: listed.error });
			return listed;
		}
		this.#setAcpOptions(id, { state: "ready", data: listed.value.options });
		return ok(listed.value.options);
	}

	/** Sets the option through the sidecar and stores the new choice in the chat's `acpConfig`. */
	async setAcpOption(
		id: SessionId,
		optionId: string,
		value: string | boolean,
	): Promise<Result<void>> {
		return this.#configWrites.run(id, async () => {
			const found = await this.#session(id);
			if (!found.ok) return found;
			const session = found.value;
			const changed = await this.#deps.sidecar.request("setAcpConfigOption", {
				sessionId: id,
				optionId,
				value,
			});
			if (!changed.ok) return changed;
			this.#setAcpOptions(id, { state: "ready", data: changed.value.options });
			const nextConfig: SessionConfig = {
				...session.config,
				acpConfig: { ...(session.config.acpConfig ?? {}), [optionId]: value },
			};
			return this.#persistConfig(id, nextConfig, true);
		});
	}

	#setAcpOptions(id: SessionId, options: Loadable<AcpConfigOption[]>): void {
		this.store.setState((state) => ({
			acpConfigOptions: { ...(state.acpConfigOptions ?? {}), [id]: options },
		}));
	}

	/**
	 * Starts the chat's agent without a turn, with its launch and resume token, so it can report
	 * its options (AGENT-17) or resume after the sidecar lost it (SIDE-21). With no launch settings,
	 * or a launch that cannot be built, nothing is started and the reason is returned.
	 */
	async warm(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		return this.#warm(found.value);
	}

	async #warm(session: Session): Promise<Result<void>> {
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
		const launch = await launchFor(session);
		if (!launch.ok) return launch;
		const resume = this.#resumeFor(session);
		const warmed = await this.#deps.sidecar.request("warmAgent", {
			sessionId: session.id,
			config: session.config,
			workspace: workspace.value,
			launch: launch.value,
			...(resume === null ? {} : { resume }),
		});
		return warmed.ok ? ok(undefined) : warmed;
	}

	/** Mirrors a fork's resume point in the chat store, after the database holds it. */
	#storeForkResume(id: SessionId, nativeMessageId: string | null): void {
		this.store.setState((state) => {
			const current = state.sessions[id];
			if (current === undefined || current.forkResumeNativeMessageId === nativeMessageId) return {};
			return {
				sessions: {
					...state.sessions,
					[id]: { ...current, forkResumeNativeMessageId: nativeMessageId },
				},
			};
		});
	}

	/**
	 * The resume a chat's next agent start carries: its stored agent session id, and for a fork
	 * whose first send has not gone yet, the message to resume at (CHAT-16).
	 */
	#resumeFor(session: Session): { agentSessionId: string; atNativeMessageId?: string } | null {
		if (session.agentSessionId === null) return null;
		return session.forkResumeNativeMessageId === null
			? { agentSessionId: session.agentSessionId }
			: {
					agentSessionId: session.agentSessionId,
					atNativeMessageId: session.forkResumeNativeMessageId,
				};
	}

	/**
	 * The goal bar's Save and the composer's goal mode: sends `/goal <objective>` as a steer. A
	 * chat that is not Codex, or an objective with no text, is refused before anything is sent.
	 */
	async setGoal(id: SessionId, objective: string): Promise<Result<void>> {
		const chat = await this.#goalChat(id);
		if (!chat.ok) return chat;
		const text = objective.trim();
		if (text.length === 0) return err(appError("goal_empty", GOAL_EMPTY));
		return this.send(id, `/goal ${text}`, [], "steer");
	}

	/** The goal bar's Pause goal, Resume goal and Clear goal: sends `/goal <action>` as a steer. */
	async changeGoal(id: SessionId, action: "pause" | "resume" | "clear"): Promise<Result<void>> {
		const chat = await this.#goalChat(id);
		if (!chat.ok) return chat;
		return this.send(id, `/goal ${action}`, [], "steer");
	}

	/**
	 * Reads a Codex chat's goal for the goal bar. Only a chat whose Codex thread exists can have
	 * one, so a chat with no thread is left alone and its agent is not started. Only the newest
	 * read, and no read a `goalChanged` notification overtook, changes the store.
	 */
	async loadGoal(id: SessionId): Promise<Result<void>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		const session = found.value;
		if (session.config.agent !== "codex" || session.agentSessionId === null) return ok(undefined);
		const ticket = this.#goalRequests.begin(id);
		const warmed = await this.#warm(session);
		if (!this.#goalRequests.isLatest(ticket)) return warmed;
		if (!warmed.ok) {
			this.#goalRequests.settle(ticket);
			return warmed;
		}
		const read = await this.#deps.sidecar.request("getGoal", { sessionId: id });
		if (!this.#goalRequests.isLatest(ticket)) return read.ok ? ok(undefined) : read;
		this.#goalRequests.settle(ticket);
		if (!read.ok) return read;
		this.#setGoalState(id, read.value.goal);
		return ok(undefined);
	}

	/** Shows the goal the sidecar reports (the goalChanged notification). */
	applyGoalChanged(id: SessionId, goal: CodexGoal | null): void {
		// A notification is newer than any read still on its way.
		this.#goalRequests.invalidate(id);
		this.#setGoalState(id, goal);
	}

	async #goalChat(id: SessionId): Promise<Result<Session>> {
		const found = await this.#session(id);
		if (!found.ok) return found;
		if (found.value.config.agent !== "codex") {
			return err(appError("goal_unavailable", GOAL_UNAVAILABLE));
		}
		return found;
	}

	#setGoalState(id: SessionId, goal: CodexGoal | null): void {
		this.store.setState((state) => ({ goals: { ...(state.goals ?? {}), [id]: goal } }));
	}
}
