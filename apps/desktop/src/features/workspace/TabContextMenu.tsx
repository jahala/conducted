/**
 * @feature CHAT-01 Chat tab context menu
 * Owns: The right-click menu of a chat tab.
 * Behaviour: ui-map.md 3.2 (chat tab menu: Mark as read or unread, Rename chat, Fork to new tab,
 * Copy concise transcript, Copy full transcript, Copy link, Close tab, Close others).
 * Our design choice: Copy session info is an internal item and is left out. Fork to new tab needs a
 * checkpoint and is disabled without one.
 * Must handle: Chat with no turns (copy and fork disabled); a transcript copy that fails shows a
 * toast; Close others with one tab open (disabled); items show shortcuts from the command registry.
 * Test first: Choosing 'Copy full transcript' calls sessions.copyTranscript(id, 'full').
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";

export interface TabContextMenuProps {
	sessionId: SessionId;
	children: ReactNode;
}

export function TabContextMenu(_props: TabContextMenuProps): never {
	return notImplemented("CHAT-01");
}
