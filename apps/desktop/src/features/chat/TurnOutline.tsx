/**
 * @feature CHAT-25 Turn outline and jump list
 * Owns: the "Table of contents" control beside the message list: a thin strip of ticks, one per turn, and a
 * list of turn summaries that jumps the chat to a turn.
 * Behaviour: coverage/inventory-controls.md (a button labelled "Table of contents" next to the message list;
 * a thin strip of ticks where plans are marked and the current turn is highlighted; it opens a list of turns
 * with a one-line summary each; picking one scrolls the chat to that turn); ui-map.md 3.3 (the chat list is
 * virtualised, one item per turn); services-map.md 2.5.2 (Conductor's cloud chats read a turn outline from
 * the server; a local chat builds it from the turns it already has).
 * Our design choice: the outline is built from `ChatTurn[]` on this Mac. The one-line summary is the first
 * line of the user's message, cut to one line, or "Started by the agent" for a turn the agent started. A
 * turn that proposed a plan gets a taller, accent-coloured tick.
 * Must handle: a chat with no turns (nothing shown); one turn (the strip is hidden, nothing to jump
 * between); 2,000 turns (ticks are grouped to fit the strip's height, the list is virtualised); the current
 * turn changing while the user scrolls (only the newest scroll position updates the highlight); a jump to a
 * turn that the virtual list has not drawn (it scrolls by index first, then aligns); a running turn (its
 * tick pulses only when reduced motion is off); the list opening and closing from the keyboard with focus
 * returned to the button.
 * Test first: three turns give three ticks; picking the second calls onJumpToTurn with its id.
 */
import type { TurnId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { ChatTurn } from "../../core/model.ts";

export interface TurnOutlineProps {
	turns: readonly ChatTurn[];
	/** The turn at the top of the visible part of the list. Null when none is visible yet. */
	currentTurnId: TurnId | null;
	onJumpToTurn: (turnId: TurnId) => void;
}

export function TurnOutline(_props: TurnOutlineProps): never {
	return notImplemented("CHAT-25");
}
