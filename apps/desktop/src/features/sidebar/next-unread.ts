/**
 * @feature NAV-11 Next unread
 * Owns: Choosing the next workspace or chat that needs the user: the target of the 'Go to next
 * unread' command and the 'Next unread' button.
 * Behaviour: ui-map.md 3.3 ('Next unread' button), 5.1 ('Go to next unread'), 5.4 ('Next chat
 * needing attention', Cmd+Alt+L).
 * Our design choice: Order: chats that wait for the user first (question, permission, plan review),
 * then unread chats; within each, oldest waiting first. The current chat is skipped.
 * Must handle: Nothing unread (null, the button is disabled); only the current chat is unread
 * (null); archived workspaces are skipped; calling twice in a row walks through the list and wraps
 * around.
 * Test first: With one chat waiting for permission and one merely unread, the waiting chat comes
 * first.
 */

import type { SessionId, WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
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

export function chooseNextUnread(_props: {
	candidates: UnreadCandidate[];
	current: UnreadTarget | null;
}): UnreadTarget | null {
	return notImplemented("NAV-11");
}
