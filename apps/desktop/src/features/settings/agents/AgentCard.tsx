/**
 * @feature SET-03 Agent card
 * Owns: one agent program on the Agents page. Name, whether it is installed, version, path, and
 * the sign-in state with its action.
 * Behaviour: ui-map.md 6, "Agents page" (one card per provider; states "Loaded from env", "API key
 * configured", "Validation failed", "Recommended").
 * Data: the parent passes one AgentInstall from useAgentInstalls().
 * Our design choice: no download. A missing program shows how to install it and a Refresh action.
 * Must handle: not installed, installed but not signed in, signed in, signed in status unknown,
 * version check failed, a custom path in use (marked), a long path (middle truncation, copyable),
 * sign-in in flight, and the ACP agents OpenCode and Pi sharing one agent kind (the card shows the
 * ACP name, not "acp").
 * Test first: an installed, unauthenticated Claude card shows a Sign in button and an
 * authenticated one shows the signed-in state without it.
 */
import type { AgentInstall } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

export interface AgentCardProps {
	install: AgentInstall;
	signInBusy: boolean;
	onSignIn: () => void;
	onRefresh: () => void;
}

export function AgentCard(_props: AgentCardProps): never {
	return notImplemented("SET-03");
}
