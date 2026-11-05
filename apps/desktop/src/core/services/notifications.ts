/**
 * @feature CHAT-19 Notify when a chat finishes or needs the user
 * Built now: the pure rules (`shouldNotifyFinished`, `isSuppressed`, `notificationTitle`, deep
 * links, `dockBadgeCount`). The service methods are placeholders (CHAT-19, NAV-11), so the
 * settle timer, sound, native notification and click handling below are not built yet.
 * Owns: deciding when to play a sound and show a native notification, building the text and the
 * deep link, and the number on the dock icon.
 * Behaviour: services-map.md 5B.2 (settings, triggers, suppression, delay and throttle, deep
 * links, dock badge), ui-map.md 6 (General: agent notifications, completion sound).
 * Must handle: a chat that went idle notifies only after 2 seconds of staying idle, with no
 * background tasks, no error, no queued follow-up, and not twice for the same turn; a notice for
 * a chat the user is looking at in a focused window is skipped for "finished", "failed", "plan
 * ready", "question" and "permission request", but not for tool approvals; hidden chats and archived workspaces never notify; the
 * sound plays even when native notifications are off, unless the sound is "none"; titles are
 * cut to 50 characters; the dock badge counts workspaces with at least one unread open chat, not
 * chats; a click opens the deep link, and on a cold start only the newest link is used.
 * Our design choice: the sound player is a port (`SoundPlayer`) because audio belongs to the web
 * view, not to Platform. The sound files are our own, not Conductor's. Deep links use the
 * `conducted://` scheme.
 * Test first: shouldNotifyFinished is false when a follow-up is still queued.
 */
import { notImplemented, type Result, type SessionId, type WorkspaceId } from "@conducted/shared";
import type { Platform } from "../../platform/platform.ts";
import type { Session, Workspace } from "../model.ts";

export const SETTLE_DELAY_MS = 2_000;
export const NOTIFICATION_TITLE_MAX = 50;
export const DEEP_LINK_SCHEME = "conducted";

export type NotificationKind =
	| "finished"
	| "failed"
	| "plan_ready"
	| "question"
	| "tool_approval"
	| "permission_request";

/** Kinds that are skipped while the user is looking at the chat (tool approvals are not). */
export const SKIPPED_WHEN_VIEWING: ReadonlySet<NotificationKind> = new Set([
	"finished",
	"failed",
	"plan_ready",
	"question",
	"permission_request",
]);

export interface FinishedInput {
	hasBackgroundTasks: boolean;
	hasError: boolean;
	queuedCount: number;
	alreadyNotifiedForTurn: boolean;
}

export const shouldNotifyFinished = (input: FinishedInput): boolean =>
	!input.hasBackgroundTasks &&
	!input.hasError &&
	input.queuedCount === 0 &&
	!input.alreadyNotifiedForTurn;

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
		if (workspace === undefined || workspace.state === "archived") continue;
		unread.add(session.workspaceId);
	}
	return unread.size;
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
}

export class NotificationService {
	readonly #deps: NotificationServiceDeps;

	constructor(deps: NotificationServiceDeps) {
		this.#deps = deps;
	}

	/** Called by the sessions service whenever a chat's live state changes. Starts or cancels the settle timer. */
	onLiveStateChanged(_sessionId: SessionId): void {
		void this.#deps;
		notImplemented("CHAT-19");
	}

	/** Plays the sound and shows the native notification for one event, honouring the rules above. */
	notify(_input: {
		sessionId: SessionId;
		kind: NotificationKind;
		body: string;
	}): Promise<Result<void>> {
		return notImplemented("CHAT-19");
	}

	/** Recomputes the dock badge. Called when unread counts or workspace states change. */
	refreshDockBadge(): Promise<Result<void>> {
		return notImplemented("NAV-11");
	}

	/** Asks for notification permission once, when the setting is first turned on. */
	ensurePermission(): Promise<Result<boolean>> {
		return notImplemented("CHAT-19");
	}
}
