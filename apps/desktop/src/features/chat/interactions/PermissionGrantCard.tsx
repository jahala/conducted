/**
 * @feature CHAT-11 Permission grant card
 * Owns: The card for Codex asking for more access (file system, network or command) than its
 * sandbox allows.
 * Behaviour: other-runners.md 4 (Codex permission grants), ui-map.md 3.3 ('Network access' card
 * with Deny and Approve).
 * Must handle: The reason, each requested path with its access (read, write, deny) and the
 * network request shown in plain words; Approve for this turn or for the session, and Deny; the
 * request expires after 300 seconds (`expiresAt`) and then shows that it timed out; the
 * interaction is withdrawn; a double click sends one answer.
 * Test first: Approve calls sessions.answer with kind permission_grant and granted true.
 */

import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface PermissionGrantCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "permission_grant" }>;
}

export function PermissionGrantCard(_props: PermissionGrantCardProps): never {
	return notImplemented("CHAT-11");
}
