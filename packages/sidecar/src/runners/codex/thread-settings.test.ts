/**
 * @feature AGENT-16 Chat options the settings offer: output style, personality, effort, Chrome
 * Owns: tests for the Codex half of the chat options: the personality, the approval policy, the
 * sandbox and when one of them changed.
 * Test first: with `requireToolApproval` on and no explicit policy, the policy is `on-request`.
 */
import { describe, expect, test } from "bun:test";
import type { SessionConfig } from "@conducted/protocol";
import {
	codexEffort,
	codexSettingsChanged,
	codexThreadSettings,
	narrowToRequirements,
} from "./thread-settings.ts";

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
	return {
		agent: "codex",
		model: "gpt-5",
		effort: "medium",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: true, progressUpdates: true, setTargetBranch: false },
		...overrides,
	};
}

describe("AGENT-16 Codex thread settings", () => {
	test("with tool approval on and no explicit policy, the policy is on-request", () => {
		expect(codexThreadSettings(config({ requireToolApproval: true })).approvalPolicy).toBe(
			"on-request",
		);
	});

	test("with tool approval off and no explicit policy, the policy is never", () => {
		expect(codexThreadSettings(config()).approvalPolicy).toBe("never");
	});

	test("an explicit approval policy wins over the tool approval switch", () => {
		expect(
			codexThreadSettings(config({ requireToolApproval: false, codexApprovalPolicy: "untrusted" }))
				.approvalPolicy,
		).toBe("untrusted");
		expect(
			codexThreadSettings(config({ requireToolApproval: true, codexApprovalPolicy: "never" }))
				.approvalPolicy,
		).toBe("never");
	});

	test("the sandbox defaults to full access and an explicit one is kept", () => {
		expect(codexThreadSettings(config()).sandbox).toBe("danger-full-access");
		expect(codexThreadSettings(config({ codexSandboxMode: "workspace-write" })).sandbox).toBe(
			"workspace-write",
		);
	});

	test("a missing personality sends nothing and every chosen tone is kept", () => {
		expect(codexThreadSettings(config()).personality).toBeUndefined();
		for (const personality of ["none", "pragmatic", "friendly"] as const) {
			expect(codexThreadSettings(config({ codexPersonality: personality })).personality).toBe(
				personality,
			);
		}
	});
});

describe("AGENT-16 Codex settings change rule", () => {
	test("the defaults mean no change, and none is a real choice", () => {
		expect(codexSettingsChanged(config(), config())).toBe(false);
		expect(codexSettingsChanged(config(), config({ codexPersonality: "none" }))).toBe(true);
		expect(codexSettingsChanged(config(), config({ codexSandboxMode: "danger-full-access" }))).toBe(
			false,
		);
	});

	test("each of the three options reports its own change", () => {
		expect(codexSettingsChanged(config(), config({ codexPersonality: "friendly" }))).toBe(true);
		expect(codexSettingsChanged(config(), config({ codexApprovalPolicy: "on-request" }))).toBe(
			true,
		);
		expect(codexSettingsChanged(config(), config({ codexSandboxMode: "read-only" }))).toBe(true);
		expect(codexSettingsChanged(config(), config({ requireToolApproval: true }))).toBe(true);
	});

	test("a change to another setting is not a Codex option change", () => {
		expect(codexSettingsChanged(config(), config({ model: "gpt-5-mini" }))).toBe(false);
		expect(codexSettingsChanged(config(), config({ effort: "high" }))).toBe(false);
	});
});

describe("AGENT-16 the effort levels Codex accepts", () => {
	test("every Codex level passes as it is", () => {
		for (const effort of ["none", "low", "medium", "high", "xhigh", "max", "ultra"] as const) {
			expect(codexEffort(effort)).toEqual({ ok: true, value: effort });
		}
	});

	test("Claude's ultracode is an error value that asks for another level", () => {
		const result = codexEffort("ultracode");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("codex_effort_unsupported");
	});
});

describe("AGENT-16 Codex managed requirements narrow the approval policy and sandbox", () => {
	const allowed = (approvals: string[] | null, sandboxes: string[] | null) => ({
		allowedApprovalPolicies: approvals,
		allowedSandboxModes: sandboxes,
	});
	const ask = (approvalPolicy: string, sandbox: string) =>
		({ approvalPolicy, sandbox, personality: undefined }) as ReturnType<typeof codexThreadSettings>;

	// Each case is one run of Conductor's sidecar against codex requirements in the sidecar
	// differential run (scenarios codex-requirements*), 7 November 2026.
	test("an allowed request is kept, and no requirements change nothing", () => {
		const settings = ask("on-request", "danger-full-access");
		expect(narrowToRequirements(settings, null)).toEqual(settings);
		expect(narrowToRequirements(settings, allowed(null, null))).toEqual(settings);
		expect(
			narrowToRequirements(settings, allowed(["on-request", "never"], ["danger-full-access"])),
		).toEqual(settings);
	});

	test("a refused request falls to the widest allowed choice below it, in any list order", () => {
		for (const lists of [
			allowed(["untrusted", "on-request"], ["read-only", "workspace-write"]),
			allowed(["on-request", "untrusted"], ["workspace-write", "read-only"]),
		]) {
			expect(narrowToRequirements(ask("never", "danger-full-access"), lists)).toMatchObject({
				approvalPolicy: "on-request",
				sandbox: "workspace-write",
			});
		}
		for (const lists of [
			allowed(["untrusted", "never"], ["read-only", "danger-full-access"]),
			allowed(["never", "untrusted"], ["danger-full-access", "read-only"]),
		]) {
			expect(narrowToRequirements(ask("on-request", "workspace-write"), lists)).toMatchObject({
				approvalPolicy: "untrusted",
				sandbox: "read-only",
			});
		}
	});

	test("with nothing allowed below it, the policy takes the narrowest wider choice and the sandbox stays", () => {
		for (const lists of [
			allowed(["on-request", "never"], ["workspace-write", "danger-full-access"]),
			allowed(["never", "on-request"], ["danger-full-access", "workspace-write"]),
		]) {
			expect(narrowToRequirements(ask("untrusted", "read-only"), lists)).toMatchObject({
				approvalPolicy: "on-request",
				sandbox: "read-only",
			});
		}
		expect(
			narrowToRequirements(
				ask("on-request", "workspace-write"),
				allowed(["never"], ["danger-full-access"]),
			),
		).toMatchObject({ approvalPolicy: "never", sandbox: "workspace-write" });
	});
});
