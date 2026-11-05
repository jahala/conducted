/**
 * @feature AGENT-11 ACP client and runner: permission requests
 * Owns: picking the ACP permission option for the user's answer, telling a permission request that
 * is really a question, and turning a stop reason into a turn outcome.
 * Behaviour: research/conductor/other-runners.md section 4 (ACP row): `session/request_permission`
 * becomes a tool approval; the answer maps to the allow_once, allow_always and reject kinds; a
 * request with two or more allow options and no reject option is treated as a question; with
 * approvals off the client answers allow_once itself; a cancelled turn ends with stopReason
 * "cancelled". ACP option kinds and stop reasons are from @agentclientprotocol/sdk.
 * Must handle: a request with no matching kind (the response is "cancelled" rather than guessing),
 * allow_always only when offered (else allow_once), reject_always only when reject_once is missing,
 * an empty option list, and every stop reason (max_tokens, max_turn_requests and refusal are
 * errors with a plain-language message).
 * Test first: for options [allow_once, reject_once], answer "deny" selects the reject_once id.
 */
import type {
	PermissionOption,
	RequestPermissionResponse,
	StopReason,
} from "@agentclientprotocol/sdk";
import type { InteractionAnswer } from "@conducted/protocol";
import type { TurnOutcome } from "../runner.ts";

export function permissionResponseFor(
	options: readonly PermissionOption[],
	answer: InteractionAnswer,
): RequestPermissionResponse {
	const cancelled: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
	if (answer.kind !== "tool_approval") return cancelled;
	const byKind = (kind: PermissionOption["kind"]) => options.find((option) => option.kind === kind);
	let chosen: PermissionOption | undefined;
	switch (answer.decision) {
		case "allow":
			chosen = byKind("allow_once");
			break;
		case "allow_edits_for_session":
		case "always_allow":
		// The agent's own "always" option is the rule it suggests.
		case "allow_with_suggested_rules":
			chosen = byKind("allow_always") ?? byKind("allow_once");
			break;
		case "deny":
			chosen = byKind("reject_once") ?? byKind("reject_always");
			break;
	}
	return chosen ? { outcome: { outcome: "selected", optionId: chosen.optionId } } : cancelled;
}

/** The option to pick when approvals are off: the first allow_once, else the first allow kind. */
export function autoApproveOption(
	options: readonly PermissionOption[],
): PermissionOption | undefined {
	return (
		options.find((option) => option.kind === "allow_once") ??
		options.find((option) => option.kind === "allow_always")
	);
}

/** Two or more allow options and no reject option is a choice between answers, not an approval. */
export function isQuestionLike(options: readonly PermissionOption[]): boolean {
	const allows = options.filter((o) => o.kind === "allow_once" || o.kind === "allow_always");
	const hasReject = options.some((o) => o.kind === "reject_once" || o.kind === "reject_always");
	return allows.length >= 2 && !hasReject;
}

export function outcomeFromStopReason(stopReason: StopReason): TurnOutcome {
	switch (stopReason) {
		case "end_turn":
			return { kind: "success" };
		case "cancelled":
			return { kind: "cancelled" };
		case "max_tokens":
			return { kind: "error", message: "The agent ran out of output tokens.", retryable: false };
		case "max_turn_requests":
			return {
				kind: "error",
				message: "The agent reached its limit of model requests for one turn.",
				retryable: false,
			};
		case "refusal":
			return { kind: "error", message: "The agent refused to continue.", retryable: false };
		default:
			// The value comes from the agent over the wire, so a newer agent can send a new one.
			return {
				kind: "error",
				message: `The agent ended the turn for a reason this app does not know (${String(stopReason)}).`,
				retryable: false,
			};
	}
}
