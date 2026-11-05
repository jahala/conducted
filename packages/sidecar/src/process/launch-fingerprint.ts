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
import { createHash } from "node:crypto";
import type { AgentLaunch } from "@conducted/protocol";

export type LaunchChange = "none" | "restart_now" | "restart_next_turn";

export interface LaunchChangeInput {
	/** The fingerprint the running agent was started with. Null when no agent runs. */
	previous: string | null;
	next: string;
	chatWorking: boolean;
	hasBackgroundTasks: boolean;
}

/** A hash of everything in the launch that decides how the agent program starts. */
export function launchFingerprint(launch: AgentLaunch): string {
	const canonical = JSON.stringify({
		executablePath: launch.executablePath ?? null,
		env: sortedPairs(launch.env),
		providerKeys: sortedPairs(
			Object.fromEntries(
				Object.entries(launch.providerKeys).map(([name, key]) => [name, key.value]),
			),
		),
		provider: launch.provider ?? null,
		baseUrl: launch.baseUrl ?? null,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

/** What a new fingerprint means for the running agent. */
export function decideLaunchChange(input: LaunchChangeInput): LaunchChange {
	if (input.previous === null || input.previous === input.next) return "none";
	if (input.chatWorking || input.hasBackgroundTasks) return "restart_next_turn";
	return "restart_now";
}

/** Key-value pairs in name order, so two launches that differ only in insertion order match. */
function sortedPairs(values: Readonly<Record<string, string>>): [string, string][] {
	return Object.entries(values).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
}
