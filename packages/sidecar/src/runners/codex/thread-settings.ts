/**
 * @feature AGENT-16 Chat options the settings offer: output style, personality, effort, Chrome
 * Owns: the Codex half of the chat options: the personality, the approval policy and the sandbox
 * mode, taken from a chat's `SessionConfig`.
 * Behaviour: other-runners.md 1 (separate Codex approval policy and sandbox fields in the session
 * config) and 4 (set per thread, defaults `never` and full access), ui-map.md 3.5 (`/personality`)
 * and 6 (the Codex personality and tool approval settings).
 * Must handle: `codexApprovalPolicy` missing (derived from `requireToolApproval`: `on-request` when
 * on, `never` when off); `codexSandboxMode` missing (`danger-full-access`, as Conductor does);
 * `codexPersonality` missing (the model's own tone, nothing sent) and every listed value,
 * including `none`, sent as it is; a change of any of the three between turns (reported so the
 * session re-opens the thread with the new options; see `CodexSession.applyConfig`).
 * Test first: with `requireToolApproval` on and no explicit policy, the policy is `on-request`.
 */
import type { SessionConfig } from "@conducted/protocol";

export interface CodexThreadSettings {
	approvalPolicy: NonNullable<SessionConfig["codexApprovalPolicy"]>;
	sandbox: NonNullable<SessionConfig["codexSandboxMode"]>;
	/** Undefined: send no personality. */
	personality: SessionConfig["codexPersonality"];
}

/** The three Codex options a config asks for, with the defaults filled in. */
export function codexThreadSettings(config: SessionConfig): CodexThreadSettings {
	return {
		approvalPolicy:
			config.codexApprovalPolicy ?? (config.requireToolApproval ? "on-request" : "never"),
		sandbox: config.codexSandboxMode ?? "danger-full-access",
		personality: config.codexPersonality,
	};
}

/** True when `next` differs from `prev` in a Codex option. */
export function codexSettingsChanged(prev: SessionConfig, next: SessionConfig): boolean {
	const before = codexThreadSettings(prev);
	const after = codexThreadSettings(next);
	return (
		before.approvalPolicy !== after.approvalPolicy ||
		before.sandbox !== after.sandbox ||
		before.personality !== after.personality
	);
}
