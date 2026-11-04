/**
 * @feature CHAT-01 Chat history button
 * Owns: The button and popover that list all chats of the workspace, including closed ones, so one
 * can be reopened.
 * Behaviour: ui-map.md 3.2 ('View chat history' lists all chats, including closed ones; 'Loading
 * chats', 'No open chats' with 'New chat').
 * Data: useSessions(workspaceId) for the open chats and useClosedSessions(workspaceId) for the
 * closed ones.
 * Must handle: Loading; error; no chats ('New chat' button); a closed chat reopens in a new tab and
 * keeps its history; a very long list scrolls and can be searched by title.
 * Test first: Choosing a closed chat calls sessions.reopen(id) and opens its tab.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface ChatHistoryButtonProps {
	workspaceId: WorkspaceId;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function ChatHistoryButton(_props: ChatHistoryButtonProps): never {
	return notImplemented("CHAT-01");
}
