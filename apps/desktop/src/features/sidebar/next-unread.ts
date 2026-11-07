/**
 * @feature NAV-11 Next unread
 * Owns: Choosing the next workspace or chat that needs the user: the target of the 'Go to next
 * unread' command and the 'Next unread' button.
 * Behaviour: ui-map.md 3.3 ('Next unread' button), 5.1 ('Go to next unread'), 5.4 ('Next chat
 * needing attention', Cmd+Alt+L).
 * Our design choice: Order: chats that wait for the user first (question, permission, plan review),
 * then unread chats; within each, oldest waiting first. The current chat is skipped. A chat waits
 * when its own open interaction says so, never by a guess from the workspace's status.
 * Must handle: Nothing unread or waiting (null, the button is hidden); only the current chat is a
 * target (null); archived workspaces are skipped; calling twice in a row walks through the list and
 * wraps around.
 * Test first: With two chats in one workspace, one waiting and one merely unread, the waiting chat
 * comes first.
 */

import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { Session, Workspace } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";

export interface UnreadCandidate {
	workspace: Workspace;
	/** The workspace's chats, closed ones included; closed chats are skipped below. */
	sessions: Session[];
	/** The chats blocked on the user right now: an open card, permission or plan review. */
	waitingSessionIds: ReadonlySet<SessionId>;
}

export interface UnreadTarget {
	workspaceId: WorkspaceId;
	sessionId: SessionId;
}

/** The moment a chat started waiting, for the oldest-first order. */
function waitingAt(session: Session): number {
	return session.updatedAt ?? session.lastUserMessageAt ?? session.createdAt;
}

function openChats(candidate: UnreadCandidate): Session[] {
	return candidate.sessions.filter((session) => session.closedAt === null);
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
		if (isArchivedWorkspace(candidate.workspace)) continue;
		for (const chat of openChats(candidate)) {
			const target = targetOf(candidate.workspace.id, chat);
			if (candidate.waitingSessionIds.has(chat.id)) {
				waiting.push({ target, at: waitingAt(chat) });
			} else if (chat.unreadCount > 0) {
				unread.push({ target, at: waitingAt(chat) });
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
