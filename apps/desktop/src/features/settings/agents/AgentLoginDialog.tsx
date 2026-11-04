/**
 * @feature SET-03 Agent sign-in dialog
 * Owns: the dialog shown while an agent's own sign-in runs. It shows the instructions, a link to
 * open, a code to copy or a terminal command (such as `claude setup-token`) when the flow has one,
 * and waits for the sign-in to finish.
 * Behaviour: ui-map.md 6, "Agents page" (CLI sign-in, device-code flow for Codex); rpc
 * startAgentLogin returns { loginId, url?, userCode?, verificationUrl?, command?, instructions },
 * then finishAgentLogin or cancelAgentLogin (packages/protocol rpc.ts).
 * Must handle: no url and no code (instructions only), the user closing the dialog mid-flow
 * (agents.cancelLogin, and the card refreshes), a timeout (Retry; Codex waits up to 10 minutes),
 * the sign-in finishing (agents.finishLogin, then the dialog closes by itself after the install
 * list refreshes), a code that must be copied exactly, and the request failing (error text, Retry).
 * Test first: with a code the dialog shows a copy button, and when the install turns authenticated
 * it calls onOpenChange(false).
 */
import { notImplemented } from "@conducted/shared";

export interface AgentLoginDialogProps {
	open: boolean;
	agentName: string;
	flow: { url?: string; code?: string; instructions: string } | null;
	error: string | null;
	onOpenUrl: (url: string) => void;
	onOpenChange: (open: boolean) => void;
	onRetry: () => void;
}

export function AgentLoginDialog(_props: AgentLoginDialogProps): never {
	return notImplemented("SET-03");
}
