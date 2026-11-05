/**
 * @feature NAV-11 Next unread
 * Owns: Choosing the next workspace or chat that needs the user: the target of the 'Go to next
 * unread' command and the 'Next unread' button.
 * Behaviour: ui-map.md 3.3 ('Next unread' button), 5.1 ('Go to next unread'), 5.4 ('Next chat
 * needing attention', Cmd+Alt+L).
 * Our design choice: Order: chats that wait for the user first (question, permission, plan review),
 * then unread chats; within each, oldest waiting first. The current chat is skipped. A waiting
 * workspace targets its oldest unread chat, else its active chat, else its oldest open chat.
 * Must handle: Nothing unread (null, the button is disabled); only the current chat is unread
 * (null); archived workspaces are skipped; calling twice in a row walks through the list and wraps
 * around.
 * Test first: With one chat waiting for permission and one merely unread, the waiting chat comes
 * first.
 */

import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { Session, Workspace, WorkspaceStatus } from "../../core/model.ts";

export interface UnreadCandidate {
	workspace: Workspace;
	status: WorkspaceStatus | null;
	sessions: Session[];
}

export interface UnreadTarget {
	workspaceId: WorkspaceId;
	sessionId: SessionId;
}

const WAITING_LABELS: ReadonlySet<string> = new Set([
	"needs_plan_review",
	"needs_permission",
	"needs_answer",
]);

function isWaiting(status: WorkspaceStatus | null): boolean {
	return status?.kind === "agent" && WAITING_LABELS.has(status.label);
}

/** The moment a chat started waiting, for the oldest-first order. */
function waitingAt(session: Session): number {
	return session.updatedAt ?? session.lastUserMessageAt ?? session.createdAt;
}

function oldestFirst(sessions: readonly Session[]): Session[] {
	return [...sessions].sort((left, right) => waitingAt(left) - waitingAt(right));
}

function openChats(candidate: UnreadCandidate): Session[] {
	return candidate.sessions.filter((session) => session.closedAt === null);
}

/** The chat that carries a waiting workspace's open request. */
function waitingChat(candidate: UnreadCandidate): Session | null {
	const chats = openChats(candidate);
	if (chats.length === 0) return null;
	const unread = chats.filter((session) => session.unreadCount > 0);
	if (unread.length > 0) return oldestFirst(unread)[0] ?? null;
	const active = chats.find((session) => session.id === candidate.workspace.activeSessionId);
	if (active !== undefined) return active;
	return oldestFirst(chats)[0] ?? null;
}

function targetOf(workspaceId: WorkspaceId, session: Session): UnreadTarget {
	return { workspaceId, sessionId: session.id };
}

/**
 * The next chat that needs the user, after `current`. Null means every target is the chat the user
 * is already looking at, or there is nothing to go to.
 */
export function chooseNextUnread({
	candidates,
	current,
}: {
	candidates: UnreadCandidate[];
	current: UnreadTarget | null;
}): UnreadTarget | null {
	const waiting: { target: UnreadTarget; at: number }[] = [];
	const unread: { target: UnreadTarget; at: number }[] = [];
	for (const candidate of candidates) {
		if (candidate.workspace.state === "archived") continue;
		const chats = openChats(candidate);
		if (isWaiting(candidate.status)) {
			const chat = waitingChat(candidate);
			if (chat !== null) {
				waiting.push({ target: targetOf(candidate.workspace.id, chat), at: waitingAt(chat) });
			}
		}
		for (const chat of chats) {
			if (chat.unreadCount > 0) {
				unread.push({ target: targetOf(candidate.workspace.id, chat), at: waitingAt(chat) });
			}
		}
	}

	// Oldest first within each group keeps the walk stable; sorting is stable for equal times.
	const ordered = [
		...waiting.sort((left, right) => left.at - right.at).map((entry) => entry.target),
		...unread.sort((left, right) => left.at - right.at).map((entry) => entry.target),
	];

	const targets: UnreadTarget[] = [];
	const seen = new Set<string>();
	for (const target of ordered) {
		const key = `${target.workspaceId}:${target.sessionId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		targets.push(target);
	}

	if (targets.length === 0) return null;
	const currentIndex =
		current === null
			? -1
			: targets.findIndex(
					(target) =>
						target.workspaceId === current.workspaceId && target.sessionId === current.sessionId,
				);
	const start = currentIndex === -1 ? 0 : currentIndex + 1;
	for (let step = 0; step < targets.length; step += 1) {
		const target = targets[(start + step) % targets.length];
		if (target === undefined) continue;
		if (
			current !== null &&
			target.workspaceId === current.workspaceId &&
			target.sessionId === current.sessionId
		) {
			continue;
		}
		return target;
	}
	return null;
}
