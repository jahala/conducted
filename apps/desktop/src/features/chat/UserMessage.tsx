/**
 * @feature CHAT-06 User message
 * Owns: The user's message in a turn: text, mention chips, attachments and the hover actions.
 * Behaviour: ui-map.md 3.3 (user message: attachments, mention chips, 'Sent via' or 'Sent from
 * another session'; hover actions include revert; 'Message not sent' with Retry and Discard).
 * Must handle: Not sent (error state with Retry and Discard); a very long message collapses with
 * 'Show more'; image attachments show a thumbnail and a missing file shows its name; mention chips
 * for files and PRs open the file or PR tab; text is selectable and copyable.
 * Test first: A message with two attachment paths renders two attachment items; a failed send shows
 * Retry and Discard.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { ChatTurn } from "../../core/model.ts";

export interface UserMessageProps {
	turn: ChatTurn;
	sessionId: SessionId;
}

export function UserMessage(_props: UserMessageProps): never {
	return notImplemented("CHAT-06");
}
