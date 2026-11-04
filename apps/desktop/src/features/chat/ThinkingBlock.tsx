/**
 * @feature CHAT-09 Thinking block
 * Owns: The collapsible 'Thinking' card that shows the agent's reasoning.
 * Behaviour: ui-map.md 3.3 (Thinking: collapsible 'Thinking' card; search 'Find in messages and
 * thinking'), frontend.md 5.
 * Our design choice: Collapsed by default once the turn is done, open while it streams. When the
 * agent sent only a summary (`summarized`), the card says so.
 * Must handle: Empty thinking text (renders nothing); streaming (grows in place, auto-collapses at
 * the end of the turn unless the user opened it); very long text scrolls inside the card;
 * summarised text is labelled.
 * Test first: A finished turn's thinking block is collapsed; clicking the header shows the text.
 */
import { notImplemented } from "@conducted/shared";

export interface ThinkingBlockProps {
	text: string;
	summarized: boolean;
}

export function ThinkingBlock(_props: ThinkingBlockProps): never {
	return notImplemented("CHAT-09");
}
