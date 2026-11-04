/**
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys
 * Owns: a fingerprint of how a chat's agent was started (program path, environment, provider keys,
 * provider, base URL), and the rule that says what a change of fingerprint means for the running
 * agent.
 * Behaviour: research/conductor/sessions.md 1 and 4 (agents are reused while their settings key
 * matches; when settings or variables change, an agent restarts only when no chat has a running
 * turn or background task, otherwise at its next request), claude-runner.md 1.2.
 * Must handle: the same launch in a different key order (same fingerprint); a launch with secrets
 * (the fingerprint is a hash, never the values, and is safe to log); a first launch (no previous
 * fingerprint: nothing to restart); a change while a turn runs or background tasks exist (restart
 * at the next turn, not now); a change on an idle chat (restart now, with resume); a change that
 * only reorders keys (none).
 * Our design choice: the fingerprint is per chat, because the process key is agent plus session
 * (D032), not per workspace folder as in Conductor.
 * Test first: two launches that differ only in the order of their environment keys have equal
 * fingerprints; changing one provider key changes the fingerprint.
 */
import type { AgentLaunch } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

export type LaunchChange = "none" | "restart_now" | "restart_next_turn";

export interface LaunchChangeInput {
	/** The fingerprint the running agent was started with. Null when no agent runs. */
	previous: string | null;
	next: string;
	chatWorking: boolean;
	hasBackgroundTasks: boolean;
}

/** A hash of everything in the launch that decides how the agent program starts. */
export function launchFingerprint(_launch: AgentLaunch): string {
	return notImplemented("SIDE-21");
}

/** What a new fingerprint means for the running agent. */
export function decideLaunchChange(_input: LaunchChangeInput): LaunchChange {
	return notImplemented("SIDE-21");
}
