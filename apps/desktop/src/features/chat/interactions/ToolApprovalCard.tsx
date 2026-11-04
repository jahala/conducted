/**
 * @feature CHAT-11 Tool approval card
 * Owns: The card that asks whether the agent may run a tool: what it wants to do, why, and the
 * buttons.
 * Behaviour: ui-map.md 3.3 (Approval card: title by tool such as 'Do you want to run this
 * command?', 'make these changes?', 'fetch this page?'; shows the tool card or the decision reason;
 * buttons 'Yes' (Enter), 'Yes for this session' or 'Yes always' (Cmd+Enter), 'No' (Backspace)),
 * claude-runner.md 3.2.
 * Our design choice: Our decisions are allow, allow_edits_for_session, always_allow and deny (see
 * the protocol). The secondary button label depends on the tool: edits offer 'Allow all edits
 * during this session', commands offer 'Always allow'. 'No' can carry a short message to the agent.
 * Must handle: A blocked path outside the workspace (show the path and say so); the tool input is
 * long (collapsed with 'Show all'); the interaction is withdrawn (card disappears); keyboard
 * shortcuts only fire when the card has focus or the composer is empty, never while typing a
 * message; one decision per card, then the card shows what was chosen.
 * Test first: Pressing Enter on a bash approval calls sessions.answer with decision 'allow';
 * Backspace sends 'deny'.
 */

import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ToolApprovalCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "tool_approval" }>;
}

export function ToolApprovalCard(_props: ToolApprovalCardProps): never {
	return notImplemented("CHAT-11");
}
