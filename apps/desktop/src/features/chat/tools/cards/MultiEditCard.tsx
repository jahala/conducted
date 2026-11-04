/**
 * @feature CHAT-08 Multi-edit card
 * Owns: The card for several edits to one file in one call.
 * Behaviour: frontend.md 5 (registry key 'multi-edit').
 * Must handle: One failed edit among many (which one failed is named); a long list (collapsed after
 * the first three); the edits apply in order and the card shows them in order.
 * Test first: Three edits render three diff parts in call order.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function MultiEditCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
