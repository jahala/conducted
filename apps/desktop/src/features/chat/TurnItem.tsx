/**
 * @feature CHAT-06 Chat turn
 * Owns: One list item: the user's message, steers sent during the turn, the assistant's blocks,
 * banners and the turn footer.
 * Behaviour: frontend.md 5 (one item per turn), ui-map.md 3.3 (user message with attachments and
 * mention chips; assistant text; thinking; footer; 'Interrupted by user'; per-turn boundary).
 * Our design choice: Wrapped in the shared ErrorBoundary so one broken turn does not hide the
 * others. Blocks render through ChatBlockView.
 * Must handle: A running turn (live caret or spinner, no footer yet); a turn that ended in error,
 * cancelled or interrupted (banner); a reverted turn (dimmed, labelled); steers not yet read by the
 * agent (marked pending); the last turn (footer actions always visible).
 * Test first: A turn with one text block and a tool block renders both in order; a thrown render
 * error shows the boundary text and the next turn still renders.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { ChatTurn } from "../../core/model.ts";

export interface TurnItemProps {
	turn: ChatTurn;
	sessionId: SessionId;
	isLast: boolean;
}

export function TurnItem(_props: TurnItemProps): never {
	return notImplemented("CHAT-06");
}
