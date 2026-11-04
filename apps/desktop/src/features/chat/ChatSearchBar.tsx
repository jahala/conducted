/**
 * @feature CHAT-17 Chat search bar
 * Owns: The find bar over the message list: query, match count, next and previous.
 * Behaviour: ui-map.md 3.3 (Search in chat: Cmd+F, next Cmd+G, previous Cmd+Shift+G, 'Scroll to
 * current match' Cmd+Alt+J), 5.1 (chat history search).
 * Must handle: No matches ('0 results'); matches in thinking and tool output (included); the match
 * is in a virtualised-out turn (scroll it into view first); Escape closes and returns focus to the
 * composer; the query is kept while switching chats.
 * Test first: Typing 'foo' with three matches shows '1 of 3' and Cmd+G moves to '2 of 3'.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ChatSearchBarProps {
	sessionId: SessionId;
	open: boolean;
	onClose: () => void;
}

export function ChatSearchBar(_props: ChatSearchBarProps): never {
	return notImplemented("CHAT-17");
}
