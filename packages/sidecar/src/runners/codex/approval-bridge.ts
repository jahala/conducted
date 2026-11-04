/**
 * @feature AGENT-08 Codex: approvals, permission grants, MCP forms
 * Owns: registering the handlers for the five server requests on the app-server client, and
 * connecting each to TurnCallbacks.requestInteraction using the mappings in approvals.ts.
 * Behaviour: research/conductor/other-runners.md section 4 (Codex row) and sections 2.1 (policy per
 * thread: approvalPolicy and sandbox are set at thread/start and can be overridden per turn).
 * Must handle:
 *  - each handler uses the callbacks of the turn that is running; a request between turns is
 *    declined (command, file, permission) or cancelled (form)
 *  - the abort of a turn (interrupt) resolves waiting requests as cancel
 *  - one interaction at a time is enforced by the broker; handlers just await it
 *  - approval policy: requireToolApproval true maps to a policy that asks ("on-request"), false to
 *    "never"; the sandbox follows the chat's folders (workspace-write with the additional
 *    directories). Conductor defaults to approvalPolicy never and sandbox danger-full-access; the
 *    mapping from our single switch is our design choice and is checked at implementation time
 *    against what each value does in the installed Codex
 *  - the question tool (`item/tool/requestUserInput`): each question's options become labels,
 *    answers are returned keyed by question id
 * Test first: a command approval request opens a tool_approval interaction named Bash with the
 * command text, and an "allow" answer returns { decision: "accept" }.
 */
import type { SessionConfig } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { TurnCallbacks } from "../runner.ts";
import type { CodexAppServerClient } from "./app-server-client.ts";
import type { CodexApprovalPolicy, CodexSandboxMode } from "./protocol.ts";

export interface CodexPolicy {
	approvalPolicy: CodexApprovalPolicy;
	sandbox: CodexSandboxMode;
}

/** Maps the chat's approval switch to Codex's thread policy. */
export function policyFor(_config: SessionConfig): CodexPolicy {
	return notImplemented("AGENT-08");
}

export class CodexApprovalBridge {
	constructor(
		protected readonly deps: {
			client: CodexAppServerClient;
			callbacks(): TurnCallbacks | undefined;
		},
	) {}

	/** Registers the five server-request handlers on the client. Call once after connect(). */
	register(): void {
		notImplemented("AGENT-08");
	}
}
