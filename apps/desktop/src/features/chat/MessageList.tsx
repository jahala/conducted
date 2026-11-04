/**
 * @feature CHAT-06 Message list
 * Owns: The virtualised list of turns in a chat, with a header for older history, a footer for the
 * live state, and the scroll-to-bottom behaviour.
 * Behaviour: frontend.md 5 (one virtualised item per turn, keyed by turn id; Header for history
 * loading; Footer; a 'Scroll to bottom' button over the list; increaseViewportBy 600), ui-map.md
 * 3.3 (list).
 * Our design choice: Built on react-virtuoso's Virtuoso (MIT) instead of the commercial
 * VirtuosoMessageList. Use data + computeItemKey (turn id), increaseViewportBy, followOutput
 * (follow only while the user is at the bottom, via atBottomStateChange), components.Header and
 * components.Footer, and a ref to scrollToIndex. Only the newest turn changes while streaming:
 * TurnItem is memoised on the turn object, and the service (CHAT-07) keeps unchanged turns
 * referentially equal.
 * Must handle: Loading (skeleton turns); error with retry; empty chat (EmptyChat with starters); a
 * turn added while the user reads old messages (no jump, show Scroll to bottom); the chat switches
 * (list resets to the bottom); a very long turn; archived workspace (read-only, composer bar says
 * so); each turn in its own boundary 'This chat turn failed to render. Other turns are still
 * available.'; 5000 turns stay smooth.
 * Test first: With 2000 turns only a small window of TurnItem is mounted; appending a block to the
 * last turn re-renders only that item.
 */

import type { SessionId, WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface MessageListProps {
	sessionId: SessionId;
	workspaceId: WorkspaceId;
}

export function MessageList(_props: MessageListProps): never {
	return notImplemented("CHAT-06");
}
