/**
 * @feature AGENT-16 Chat options the settings offer: output style, personality, effort, Chrome
 * Owns: the Codex half of the chat options: the personality, the approval policy, the sandbox
 * mode and the effort levels Codex accepts, taken from a chat's `SessionConfig`.
 * Behaviour: other-runners.md 1 (separate Codex approval policy and sandbox fields in the session
 * config) and 4 (set per thread, defaults `never` and full access), ui-map.md 3.5 (`/personality`)
 * and 6 (the Codex personality and tool approval settings), native-and-sidecar-map.md (effort levels
 * by agent: Codex takes none, low, medium, high, xhigh, max and ultra).
 * Must handle: `codexApprovalPolicy` missing (derived from `requireToolApproval`: `on-request` when
 * on, `never` when off); `codexSandboxMode` missing (`danger-full-access`, as Conductor does);
 * `codexPersonality` missing (the model's own tone, nothing sent) and every listed value,
 * including `none`, sent as it is; a change of any of the three between turns (reported so the
 * session re-opens the thread with the new options; see `CodexSession.applyConfig`); Claude's
 * `ultracode` effort, which a chat keeps when it changes agent (an error value that asks for another
 * level, never a guessed one). The sandbox is set on `thread/start` and `thread/resume` only, since
 * Codex fixes it per thread; `turn/start` carries the approval policy.
 * Managed requirements: Codex reports the approval policies and sandbox modes an administrator
 * allows (`configRequirements/read`). Conductor reads them before a thread starts and narrows the
 * chat's choice; `narrowToRequirements` does the same, by the rule the sidecar differential run
 * measured on Conductor's sidecar (other-runners.md 4): an allowed choice is kept; else the widest
 * allowed choice below it; with none below, the approval policy takes the narrowest wider one and
 * the sandbox stays as asked. List order does not matter. A granular policy object in the list is
 * not one of our choices and is passed over.
 * Test first: with `requireToolApproval` on and no explicit policy, the policy is `on-request`.
 */
import type { Effort, SessionConfig } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import type { CodexConfigRequirements } from "./protocol.ts";

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

type ApprovalPolicy = CodexThreadSettings["approvalPolicy"];
type SandboxMode = CodexThreadSettings["sandbox"];

/**
 * From the fewest actions without asking to the most. `on-failure` is not in codex-cli 0.154.0's
 * protocol; it sits where older Codex versions declared it, between `untrusted` and `on-request`.
 */
const APPROVAL_ORDER: readonly ApprovalPolicy[] = [
	"untrusted",
	"on-failure",
	"on-request",
	"never",
];
const SANDBOX_ORDER: readonly SandboxMode[] = [
	"read-only",
	"workspace-write",
	"danger-full-access",
];

/** The choices of `order` that a requirements list allows. Null: the list sets no limit. */
function allowedOf<T extends string>(list: unknown[] | null, order: readonly T[]): T[] | null {
	if (list === null) return null;
	return order.filter((choice) => list.includes(choice));
}

/** The widest allowed choice no wider than `asked`, by `order`. Undefined when there is none. */
function widestBelow<T extends string>(asked: T, allowed: readonly T[], order: readonly T[]) {
	const limit = order.indexOf(asked);
	return allowed.filter((choice) => order.indexOf(choice) <= limit).at(-1);
}

/** The settings a thread may run with under the managed requirements (null: none configured). */
export function narrowToRequirements(
	settings: CodexThreadSettings,
	requirements: CodexConfigRequirements | null,
): CodexThreadSettings {
	if (requirements === null) return settings;
	let approvalPolicy = settings.approvalPolicy;
	const approvals = allowedOf(requirements.allowedApprovalPolicies, APPROVAL_ORDER);
	if (approvals !== null && approvals.length > 0 && !approvals.includes(approvalPolicy)) {
		const limit = APPROVAL_ORDER.indexOf(approvalPolicy);
		approvalPolicy =
			widestBelow(approvalPolicy, approvals, APPROVAL_ORDER) ??
			approvals.find((choice) => APPROVAL_ORDER.indexOf(choice) > limit) ??
			approvalPolicy;
	}
	let sandbox = settings.sandbox;
	const sandboxes = allowedOf(requirements.allowedSandboxModes, SANDBOX_ORDER);
	if (sandboxes !== null && !sandboxes.includes(sandbox)) {
		sandbox = widestBelow(sandbox, sandboxes, SANDBOX_ORDER) ?? sandbox;
	}
	return { ...settings, approvalPolicy, sandbox };
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

/** The effort levels Codex accepts. */
export type CodexEffort = Exclude<Effort, "ultracode">;

/** The chat's effort as Codex takes it, or an error for a level only Claude has. */
export function codexEffort(effort: Effort): Result<CodexEffort> {
	if (effort === "ultracode") {
		return err(
			appError(
				"codex_effort_unsupported",
				"Codex has no Ultracode effort level. Choose another effort level for this chat.",
			),
		);
	}
	return ok(effort);
}
