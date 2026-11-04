/**
 * @feature CHAT-20 Send message card
 * Owns: The card for the agent sending a message to another chat.
 * Behaviour: ui-map.md 3.3 (send message).
 * Must handle: A target chat that was closed or deleted; a long message (collapsed).
 * Test first: A send_message call names the chat it went to.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SendMessageCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
