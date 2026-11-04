/**
 * @feature AGENT-16 Chat options the settings offer: output style, personality, effort, Chrome
 * Owns: the Codex half of the chat options: the personality, the approval policy and the sandbox
 * mode, taken from a chat's `SessionConfig`.
 * Behaviour: other-runners.md 1 (separate Codex approval policy and sandbox fields in the session
 * config) and 4 (set per thread, defaults `never` and full access), ui-map.md 3.5 (`/personality`)
 * and 6 (the Codex personality and tool approval settings).
 * Must handle: `codexApprovalPolicy` missing (derived from `requireToolApproval`: `on-request` when
 * on, `never` when off); `codexSandboxMode` missing (`danger-full-access`, as Conductor does);
 * `codexPersonality` missing (the model's own tone, nothing sent); a change of any of the three
 * between turns (reported so the session applies it; see `CodexSession.applyConfig`); Codex's
 * `on-failure` policy, which the app-server shapes in `protocol.ts` do not list yet (AGENT-06 checks
 * the generated bindings before it is sent).
 * Test first: with `requireToolApproval` on and no explicit policy, the policy is `on-request`.
 */
import type { SessionConfig } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

export interface CodexThreadSettings {
	approvalPolicy: NonNullable<SessionConfig["codexApprovalPolicy"]>;
	sandbox: NonNullable<SessionConfig["codexSandboxMode"]>;
	/** Undefined: send no personality. */
	personality: SessionConfig["codexPersonality"];
}

/** The three Codex options a config asks for, with the defaults filled in. */
export function codexThreadSettings(_config: SessionConfig): CodexThreadSettings {
	return notImplemented("AGENT-16");
}

/** True when `next` differs from `prev` in a Codex option. */
export function codexSettingsChanged(_prev: SessionConfig, _next: SessionConfig): boolean {
	return notImplemented("AGENT-16");
}
