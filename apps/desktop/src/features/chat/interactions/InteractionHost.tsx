/**
 * @feature CHAT-10 Interaction host
 * Owns: picking the card for one open interaction by its kind: question, tool approval, plan review,
 * permission grant, MCP form.
 * Behaviour: claude-runner.md 3 (interaction kinds), interactions schema in packages/protocol/src/interactions.ts.
 * Must handle: every interaction kind has a card (the switch is exhaustive); the card answers through
 * sessions.answer with the interaction id, so a late answer to a withdrawn interaction is dropped by the
 * service.
 * Test first: a "tool_approval" interaction renders the approval card; a "plan_approval" renders the plan bar.
 */

import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { McpFormCard } from "./McpFormCard.tsx";
import { PermissionGrantCard } from "./PermissionGrantCard.tsx";
import { PlanReviewBar } from "./PlanReviewBar.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { ToolApprovalCard } from "./ToolApprovalCard.tsx";

export interface InteractionHostProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	interaction: Interaction;
}

export function InteractionHost({ sessionId, interactionId, interaction }: InteractionHostProps) {
	switch (interaction.kind) {
		case "question":
			return (
				<QuestionCard
					sessionId={sessionId}
					interactionId={interactionId}
					questions={interaction.questions}
				/>
			);
		case "tool_approval":
			return (
				<ToolApprovalCard
					sessionId={sessionId}
					interactionId={interactionId}
					request={interaction}
				/>
			);
		case "plan_approval":
			return (
				<PlanReviewBar sessionId={sessionId} interactionId={interactionId} request={interaction} />
			);
		case "permission_grant":
			return (
				<PermissionGrantCard
					sessionId={sessionId}
					interactionId={interactionId}
					request={interaction}
				/>
			);
		case "mcp_form":
			return (
				<McpFormCard sessionId={sessionId} interactionId={interactionId} request={interaction} />
			);
	}
}
