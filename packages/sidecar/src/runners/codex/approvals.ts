/**
 * @feature AGENT-08 Codex: approvals, permission grants, MCP forms
 * Owns: translating the requests Codex sends us into interactions, and the user's answers back
 * into Codex's reply shapes.
 * Behaviour: research/conductor/other-runners.md section 4 (Codex row): command and file-change
 * approvals become tool approvals named Bash and Edit; `item/tool/requestUserInput` becomes a
 * question; `mcpServer/elicitation/request` becomes a form; `item/permissions/requestApproval`
 * becomes a permission grant; local requests wait without a timeout. The reply values below were
 * checked against the generated bindings of codex-cli 0.154.0: command decisions accept,
 * acceptForSession, decline, cancel; file-change decisions the same four without the amendments;
 * elicitation actions accept, decline, cancel; permission scopes turn and session.
 * Must handle:
 *  - "withdrawn" from the user (cancel or new message) maps to Codex's "cancel", not "decline", so
 *    Codex stops the turn instead of letting the agent retry
 *  - always_allow has no persistent form in this protocol subset; it maps to acceptForSession
 *  - a permission grant answered "granted" grants exactly what was requested for the turn only;
 *    "not granted" returns an empty profile (our design choice, protocol has one boolean)
 *  - an MCP form in a mode we cannot show (url mode): declined with a log line
 *  - the app is not connected: command and file approvals decline, permissions decline, forms
 *    cancel (Conductor: command approvals decline; others resolve as unavailable)
 *  - the question tool: option labels become the answers; free text from "Other" is passed as is
 * Test first: decisionForApproval({ kind: "tool_approval", decision: "allow_edits_for_session" })
 * is "acceptForSession" and a withdrawn answer is "cancel".
 */
import type { InteractionAnswer } from "@conducted/protocol";

export type CodexCommandDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export function decisionForApproval(answer: InteractionAnswer): CodexCommandDecision {
	if (answer.kind === "withdrawn") return "cancel";
	if (answer.kind !== "tool_approval") return "decline";
	switch (answer.decision) {
		case "allow":
		// Codex requests carry no suggested rules, so the card never offers this; it allows once.
		case "allow_with_suggested_rules":
			return "accept";
		case "allow_edits_for_session":
		case "always_allow":
			return "acceptForSession";
		case "deny":
			return "decline";
	}
}

export type CodexElicitationAction = "accept" | "decline" | "cancel";

export function elicitationReply(answer: InteractionAnswer): {
	action: CodexElicitationAction;
	content: unknown;
} {
	if (answer.kind === "withdrawn") return { action: "cancel", content: null };
	if (answer.kind !== "mcp_form") return { action: "decline", content: null };
	return {
		action: answer.action,
		content: answer.action === "accept" ? (answer.content ?? null) : null,
	};
}

/** True when the answer grants the permission. Withdrawn and mismatched answers do not. */
export function permissionGranted(answer: InteractionAnswer): boolean {
	return answer.kind === "permission_grant" && answer.granted;
}
