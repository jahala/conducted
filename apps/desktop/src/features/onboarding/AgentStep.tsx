/**
 * @feature APP-02 Onboarding: agents
 * Owns: The step that lists Claude Code, Codex, Cursor, OpenCode and Pi with whether each is
 * installed and signed in.
 * Behaviour: ui-map.md 6 (Agents page: install status, versions, sign-in), other-runners.md 5
 * (agent detection and sign-in flows).
 * Our design choice: Detection finds programs already on the user's login-shell PATH. The app does
 * not download agents (scaffold decision 7).
 * Must handle: Detection still running (spinner per row); an agent installed but not signed in
 * (button starts its login flow, shows the code or link); none installed (instructions, no dead
 * end); detection fails (message and retry); version shown when known.
 * Test first: A signed-in Claude and a missing Codex render one 'Ready' row and one 'Not installed'
 * row.
 */
import { notImplemented } from "@conducted/shared";

export interface AgentStepProps {
	onContinue: () => void;
}

export function AgentStep(_props: AgentStepProps): never {
	return notImplemented("APP-02");
}
