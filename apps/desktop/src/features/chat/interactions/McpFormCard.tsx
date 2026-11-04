/**
 * @feature CHAT-11 MCP form card
 * Owns: The card that shows a form an MCP server asks the user to fill in, and sends the values
 * back.
 * Behaviour: other-runners.md 4 (Codex MCP forms), packages/protocol/src/interactions.ts (mcp_form:
 * server, message, JSON schema).
 * Our design choice: Renders the common JSON Schema field types (string, number, boolean, enum). A
 * schema it cannot render shows the message and offers Decline only.
 * Must handle: Required fields (submit disabled until filled); invalid input (message under the
 * field); Accept, Decline and Cancel map to the three protocol actions; unknown schema (Decline
 * only, with the reason).
 * Test first: A schema with one required string blocks Accept until it has text.
 */

import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface McpFormCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "mcp_form" }>;
}

export function McpFormCard(_props: McpFormCardProps): never {
	return notImplemented("CHAT-11");
}
