/**
 * @feature CHAT-11 Permission grant card
 * Owns: The card for Codex asking for more access (file system, network or command) than its
 * sandbox allows.
 * Behaviour: other-runners.md 4 (Codex permission grants), ui-map.md 3.3 ('Network access' card
 * with Deny and Approve).
 * Must handle: Scope shown in plain words (files, network, command); Approve and Deny only, no
 * 'always'; the interaction is withdrawn; a double click sends one answer.
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
