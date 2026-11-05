/**
 * @feature CHAT-12 Plan review bar
 * Owns: The bar that shows the agent's plan and lets the user approve it, hand it to a new chat,
 * copy it, or reject it with feedback.
 * Behaviour: ui-map.md 3.3 (Plan approval: bar with 'Sending to <chat>' picker, 'Copy', 'Hand off'
 * (tooltip 'Send plan to a new chat for implementation'), 'Approve' (Cmd+Shift+Enter, tooltip
 * 'Execute plan in current chat'); a feedback box can reject the plan; sidebar text 'Review plan'),
 * claude-runner.md 3.5.
 * Our design choice: 'Approve' is the one primary button. 'Hand off' calls
 * useActions().sessions.startFromPlan(sessionId, planText, target), where target is the chat picked
 * in 'Sending to <chat>', or null for a new chat.
 * Must handle: Very long plan (scrolls, collapsed to a few lines with 'Show all'); feedback empty
 * (Reject disabled); plan file path present (a link to open the file); the interaction is
 * withdrawn; Approve sets plan mode off for the next turn.
 * Test first: Approve calls sessions.answer with kind plan_approval and approved true; Reject sends
 * the feedback text.
 */

import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface PlanReviewBarProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "plan_approval" }>;
}

export function PlanReviewBar(_props: PlanReviewBarProps): never {
	return notImplemented("CHAT-12");
}
