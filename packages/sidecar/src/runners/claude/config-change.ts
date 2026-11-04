/**
 * @feature AGENT-02 Claude: live reconfiguration
 * Owns: deciding whether a config change can be applied to the running CLI or needs a restart
 * with resume.
 * Behaviour: research/conductor/claude-runner.md section 1.5, config policy table: model and
 * effort are live control requests; plan mode and approvals derive the permission mode (live);
 * fast mode, extra directories and the tool switches need a respawn with --resume; a change during
 * a turn waits for the next turn.
 * Must handle: no change at all (nothing to do), a mix of live and restart changes (restart wins,
 * since the restart picks up everything), additional directories compared as sets in order of
 * appearance, and an agent or ACP adapter change (never handled here: the manager disposes the
 * old agent first).
 * Test first: changing only the model is "live"; changing fastMode is "restart"; no change is
 * "none".
 * Our design choice: effort is treated as live. If the CLI rejects the control request, the
 * session falls back to a restart (AGENT-02).
 */
import type { SessionConfig } from "@conducted/protocol";

export type ConfigChangeKind = "none" | "live" | "restart";

export interface ConfigChange {
	kind: ConfigChangeKind;
	/** Which live settings changed, so the session knows which control requests to send. */
	live: { model: boolean; effort: boolean; permissionMode: boolean };
}

export function classifyConfigChange(prev: SessionConfig, next: SessionConfig): ConfigChange {
	const live = {
		model: prev.model !== next.model,
		effort: prev.effort !== next.effort,
		permissionMode:
			prev.planMode !== next.planMode || prev.requireToolApproval !== next.requireToolApproval,
	};
	const restart =
		prev.fastMode !== next.fastMode ||
		!sameList(prev.additionalDirectories, next.additionalDirectories) ||
		prev.appTools.diffComments !== next.appTools.diffComments ||
		prev.appTools.progressUpdates !== next.appTools.progressUpdates;
	if (restart) return { kind: "restart", live };
	if (live.model || live.effort || live.permissionMode) return { kind: "live", live };
	return { kind: "none", live };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}
