/**
 * @feature CHAT-06 Empty chat
 * Owns: What a chat with no messages shows: a short invitation and four starter prompts.
 * Behaviour: ui-map.md 3.3 (Empty chat starters), 7.2 ('No messages yet').
 * Our design choice: The starter prompts are our own wording (for example: summarise recent
 * changes, tidy the agent instructions, fix a known bug, read the docs). Picking one puts the text
 * into the composer without sending it.
 * Must handle: Archived workspace (no starters, the composer bar explains); the user already typed
 * a draft (a starter replaces nothing without asking, it appends); keyboard reachable.
 * Test first: Clicking a starter calls onPick with its text.
 */
import { notImplemented } from "@conducted/shared";

export interface EmptyChatProps {
	onPick: (prompt: string) => void;
}

export function EmptyChat(_props: EmptyChatProps): never {
	return notImplemented("CHAT-06");
}
