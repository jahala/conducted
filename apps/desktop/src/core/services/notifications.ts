/**
 * @feature CHAT-19 Notify when a chat finishes or needs the user
 * Owns: deciding when to play a sound and show a native notification, building the text and the
 * deep link, and the number on the dock icon.
 * Behaviour: services-map.md 5B.2 (settings, triggers, suppression, delay and throttle, deep
 * links, dock badge), ui-map.md 6 (General: agent notifications, completion sound).
 * Must handle: a chat that went working notifies only after 2 seconds of staying idle, with no
 * background tasks, no open interaction, no queued follow-up, and not twice for the same turn; a
 * notice for a chat the user is looking at in a focused window is skipped for "finished",
 * "failed", "plan ready", "question", "MCP form" and "permission request", but not for tool
 * approvals; hidden chats and archived workspaces never notify; the sound plays even when native
 * notifications are off, unless the sound is "none"; titles are cut to 50 characters; the dock
 * badge counts workspaces with at least one unread open chat, not chats; a notice that fails in
 * the background (no native notification, no sound, an unknown chat) reaches the app log as a
 * warning, whether it threw or returned an error.
 * Not built here: opening the deep link is the app entry's (`main.tsx`), and the rule that a cold
 * start uses only the newest link is still open on this feature's checklist.
 * Our design choice: the sound player is a port (`SoundPlayer`) because audio belongs to the web
 * view, not to Platform. The sound files are our own, not Conductor's. Deep links use the
 * `conducted://` scheme.
 * Our design choice: the service owns one settle timer per chat, created with the timer passed in
 * by the composition root and cleared by `stop`, so tests control time and nothing is left behind.
 * Test first: a settled turn stays quiet while a follow-up is still queued
 * (notifications.chat-19.test.ts, through the service's live-state path).
 */

import type { Interaction, LiveState } from "@conducted/protocol";
import {
	appError,
	err,
	messageOf,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import type { Platform } from "../../platform/platform.ts";
import { fireAndForget } from "../async/fire-and-forget.ts";
import type { Session, Workspace } from "../model.ts";
import { isArchivedWorkspace } from "../status/archived.ts";

export const SETTLE_DELAY_MS = 2_000;
export const NOTIFICATION_TITLE_MAX = 50;
export const DEEP_LINK_SCHEME = "conducted";

export type NotificationKind =
	| "finished"
	| "failed"
	| "plan_ready"
	| "question"
	| "mcp_form"
	| "tool_approval"
	| "permission_request";

/** Kinds that are skipped while the user is looking at the chat (tool approvals are not). */
export const SKIPPED_WHEN_VIEWING: ReadonlySet<NotificationKind> = new Set([
	"finished",
	"failed",
	"plan_ready",
	"question",
	"mcp_form",
	"permission_request",
]);

export interface SettledInput {
	hasBackgroundTasks: boolean;
	queuedCount: number;
	alreadyNotifiedForTurn: boolean;
}

/**
 * A settled turn notifies unless background tasks run, a follow-up waits, or it was announced.
 * A turn that ended with an error still notifies, as the failed notice (`settledNotification`).
 */
export const shouldNotifySettled = (input: SettledInput): boolean =>
	!input.hasBackgroundTasks && input.queuedCount === 0 && !input.alreadyNotifiedForTurn;

export interface SuppressionInput {
	kind: NotificationKind;
	sessionHidden: boolean;
	workspaceArchived: boolean;
	viewingThisChat: boolean;
	windowFocused: boolean;
}

export const isSuppressed = (input: SuppressionInput): boolean => {
	if (input.sessionHidden || input.workspaceArchived) return true;
	return SKIPPED_WHEN_VIEWING.has(input.kind) && input.viewingThisChat && input.windowFocused;
};

/** Trims to 50 characters with an ellipsis. */
export const notificationTitle = (title: string): string => {
	// Count whole characters, so an emoji at the cut is not split in half.
	const characters = Array.from(title);
	return characters.length <= NOTIFICATION_TITLE_MAX
		? title
		: `${characters.slice(0, NOTIFICATION_TITLE_MAX - 1).join("")}…`;
};

export const buildDeepLink = (workspaceId: WorkspaceId, sessionId: SessionId | null): string => {
	const params = new URLSearchParams({ id: workspaceId });
	if (sessionId !== null) params.set("session", sessionId);
	return `${DEEP_LINK_SCHEME}://workspace?${params.toString()}`;
};

export interface ParsedDeepLink {
	workspaceId: WorkspaceId;
	sessionId: SessionId | null;
}

export const parseDeepLink = (url: string): ParsedDeepLink | null => {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== `${DEEP_LINK_SCHEME}:` || parsed.hostname !== "workspace") return null;
	const id = parsed.searchParams.get("id");
	if (id === null || id.length === 0) return null;
	const session = parsed.searchParams.get("session");
	return {
		workspaceId: id as WorkspaceId,
		sessionId: session === null || session.length === 0 ? null : (session as SessionId),
	};
};

/** Number of non-archived workspaces that have an unread chat that is still open. */
export function dockBadgeCount(
	workspaces: ReadonlyMap<WorkspaceId, Pick<Workspace, "state">>,
	sessions: readonly Pick<Session, "workspaceId" | "unreadCount" | "closedAt">[],
): number {
	const unread = new Set<WorkspaceId>();
	for (const session of sessions) {
		if (session.unreadCount <= 0 || session.closedAt !== null) continue;
		const workspace = workspaces.get(session.workspaceId);
		if (workspace === undefined || isArchivedWorkspace(workspace)) continue;
		unread.add(session.workspaceId);
	}
	return unread.size;
}

/** The notice for a settled turn: failed when the live state carries an error, finished otherwise. */
export function settledNotification(live: Pick<LiveState, "error">): {
	kind: "finished" | "failed";
	body: string;
} {
	return live.error === undefined
		? { kind: "finished", body: "Agent finished. Click to view session." }
		: { kind: "failed", body: "Agent failed. Click to view session." };
}

/** The notice for an interaction: what the agent waits for, in Conductor's words (5B.2.2). */
export function interactionNotification(interaction: Interaction): {
	kind: NotificationKind;
	body: string;
} {
	switch (interaction.kind) {
		case "plan_approval":
			return { kind: "plan_ready", body: "Plan ready. Click to review and approve the plan." };
		case "question":
			return { kind: "question", body: "Agent has a question. Click to answer it." };
		case "tool_approval":
			return {
				kind: "tool_approval",
				body: `${interaction.toolName} requires your permission`,
			};
		case "permission_grant":
			return { kind: "permission_request", body: "Codex requests permission" };
		case "mcp_form":
			return { kind: "mcp_form", body: `${interaction.server} needs information` };
	}
}

export interface SoundPlayer {
	play(soundId: string): Promise<void>;
}

export interface NotificationServiceDeps {
	platform: Pick<Platform, "notifications">;
	sound: SoundPlayer;
	/** Reads a setting by key (notifications_enabled, sound_type). */
	setting: <T>(key: string) => T;
	isViewing: (sessionId: SessionId) => boolean;
	windowFocused: () => boolean;
	/** The chat to name in the notice. Undefined when it is not loaded. */
	sessionOf: (
		sessionId: SessionId,
	) => Pick<Session, "workspaceId" | "title" | "closedAt"> | undefined;
	/** The workspace to name when the chat has no title. */
	workspaceOf: (
		workspaceId: WorkspaceId,
	) => Pick<Workspace, "displayName" | "directoryName" | "state"> | undefined;
	/** The live state the sidecar last reported for a chat. */
	liveStateOf: (sessionId: SessionId) => LiveState | undefined;
	/** How many follow-ups wait for the chat. */
	queuedCountOf: (sessionId: SessionId) => number;
	/** The loaded workspaces, for the dock badge. */
	workspaces: () => ReadonlyMap<WorkspaceId, Pick<Workspace, "state">>;
	/** The loaded chats, for the dock badge. */
	sessions: () => readonly Pick<Session, "workspaceId" | "unreadCount" | "closedAt">[];
	/** Starts a timer and returns its canceller. The composition root supplies the real clock. */
	setTimer: (callback: () => void, ms: number) => () => void;
	log: (level: "warn" | "info", message: string) => void;
}

interface TurnState {
	/** A turn has been seen working and its settle notice has not fired yet. */
	working: boolean;
	/** The notice for this turn has been handled, so it cannot fire twice. */
	notified: boolean;
}

export class NotificationService {
	readonly #deps: NotificationServiceDeps;
	readonly #settleTimers = new Map<SessionId, () => void>();
	readonly #turnStates = new Map<SessionId, TurnState>();
	/** The newest interaction already announced per chat, so a repeated live state is quiet. */
	readonly #announcedInteractions = new Map<SessionId, string>();
	#stopped = false;

	constructor(deps: NotificationServiceDeps) {
		this.#deps = deps;
	}

	/**
	 * Called by the sessions service whenever a chat's live state changes. Notifies for a new
	 * interaction at once, and starts or cancels the settle timer for a finished turn.
	 */
	onLiveStateChanged(sessionId: SessionId): void {
		if (this.#stopped) return;
		const live = this.#deps.liveStateOf(sessionId);
		if (live === undefined) return;

		const open = live.openInteraction;
		if (open !== undefined && this.#announcedInteractions.get(sessionId) !== open.interactionId) {
			this.#announcedInteractions.set(sessionId, open.interactionId);
			const notice = interactionNotification(open.interaction);
			this.#sendInBackground(sessionId, notice.kind, notice.body);
		}

		const turn = this.#turnState(sessionId);
		if (live.status === "working") {
			turn.working = true;
			turn.notified = false;
			this.#cancelSettle(sessionId);
			return;
		}

		// Idle with background tasks, or an open interaction, is a waiting chat. Nothing settles.
		if (live.backgroundTasks.length > 0 || open !== undefined) {
			this.#cancelSettle(sessionId);
			return;
		}
		if (!turn.working || turn.notified) return;

		this.#cancelSettle(sessionId);
		const cancel = this.#deps.setTimer(() => {
			this.#settleTimers.delete(sessionId);
			this.#inBackground(() => this.#settle(sessionId));
		}, SETTLE_DELAY_MS);
		this.#settleTimers.set(sessionId, cancel);
	}

	/** Plays the sound and shows the native notification for one event, honouring the rules above. */
	async notify(input: {
		sessionId: SessionId;
		kind: NotificationKind;
		body: string;
	}): Promise<Result<void>> {
		const session = this.#deps.sessionOf(input.sessionId);
		if (session === undefined) {
			return err(appError("notification_unknown_chat", "That chat no longer exists."));
		}
		const workspace = this.#deps.workspaceOf(session.workspaceId);
		if (workspace === undefined) {
			return err(appError("notification_unknown_workspace", "That workspace no longer exists."));
		}
		if (
			isSuppressed({
				kind: input.kind,
				sessionHidden: session.closedAt !== null,
				workspaceArchived: isArchivedWorkspace(workspace),
				viewingThisChat: this.#deps.isViewing(input.sessionId),
				windowFocused: this.#deps.windowFocused(),
			})
		) {
			return ok(undefined);
		}

		const title = notificationTitle(
			session.title ?? workspace.displayName ?? workspace.directoryName,
		);
		const deepLink = buildDeepLink(session.workspaceId, input.sessionId);
		const soundType = this.#deps.setting<string>("sound_type");
		const sound =
			soundType === "none" || soundType === "disabled"
				? Promise.resolve()
				: this.#deps.sound.play(soundType);
		const native = this.#deps.setting<boolean>("notifications_enabled")
			? this.#deps.platform.notifications.notify({ title, body: input.body, deepLink })
			: Promise.resolve();

		// Start the sound first, then the notification, and wait for both.
		const [soundOutcome, nativeOutcome] = await Promise.allSettled([sound, native]);
		if (nativeOutcome.status === "rejected") {
			return err(
				appError("notification_failed", "Could not show the notification.", nativeOutcome.reason),
			);
		}
		if (soundOutcome.status === "rejected") {
			return err(
				appError(
					"notification_sound_failed",
					"Could not play the completion sound.",
					soundOutcome.reason,
				),
			);
		}
		return ok(undefined);
	}

	/** Recomputes the dock badge. Called when unread counts or workspace states change. */
	async refreshDockBadge(): Promise<Result<void>> {
		const count = dockBadgeCount(this.#deps.workspaces(), this.#deps.sessions());
		try {
			await this.#deps.platform.notifications.setDockBadge(count === 0 ? null : count);
			return ok(undefined);
		} catch (cause) {
			return err(appError("dock_badge_failed", "Could not update the dock badge.", cause));
		}
	}

	/** Clears every settle timer. Called when the app stops. */
	stop(): void {
		this.#stopped = true;
		for (const cancel of this.#settleTimers.values()) cancel();
		this.#settleTimers.clear();
		this.#turnStates.clear();
		this.#announcedInteractions.clear();
	}

	#turnState(sessionId: SessionId): TurnState {
		const existing = this.#turnStates.get(sessionId);
		if (existing !== undefined) return existing;
		const created: TurnState = { working: false, notified: false };
		this.#turnStates.set(sessionId, created);
		return created;
	}

	#cancelSettle(sessionId: SessionId): void {
		const cancel = this.#settleTimers.get(sessionId);
		if (cancel === undefined) return;
		cancel();
		this.#settleTimers.delete(sessionId);
	}

	async #settle(sessionId: SessionId): Promise<Result<void>> {
		const turn = this.#turnStates.get(sessionId);
		if (turn === undefined || !turn.working || turn.notified) return ok(undefined);
		const live = this.#deps.liveStateOf(sessionId);
		if (
			live === undefined ||
			live.status !== "idle" ||
			live.backgroundTasks.length > 0 ||
			live.openInteraction !== undefined
		) {
			return ok(undefined);
		}
		const shouldNotify = shouldNotifySettled({
			hasBackgroundTasks: live.backgroundTasks.length > 0,
			// A follow-up waiting for the chat will start the next turn, so this settle stays quiet.
			queuedCount: this.#deps.queuedCountOf(sessionId),
			alreadyNotifiedForTurn: turn.notified,
		});
		turn.working = false;
		turn.notified = true;
		if (!shouldNotify) return ok(undefined);

		const notice = settledNotification(live);
		return this.notify({ sessionId, kind: notice.kind, body: notice.body });
	}

	#sendInBackground(sessionId: SessionId, kind: NotificationKind, body: string): void {
		this.#inBackground(() => this.notify({ sessionId, kind, body }));
	}

	/**
	 * Starts a notice without waiting for it. Nobody awaits the answer, so a failed `Result` is
	 * logged here, the same way as a throw: neither may vanish.
	 */
	#inBackground(work: () => Promise<Result<void>>): void {
		const report = (message: string): void =>
			this.#deps.log("warn", `Could not send a notification: ${message}`);
		fireAndForget(
			async () => {
				const result = await work();
				if (!result.ok) report(result.error.message);
			},
			(error) => report(messageOf(error)),
		);
	}
}
