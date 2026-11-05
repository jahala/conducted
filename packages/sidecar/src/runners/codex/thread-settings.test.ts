/**
 * @feature AGENT-16 Chat options the settings offer: output style, personality, effort, Chrome
 * Owns: tests for the Codex half of the chat options: the personality, the approval policy, the
 * sandbox and when one of them changed.
 * Test first: with `requireToolApproval` on and no explicit policy, the policy is `on-request`.
 */
import { describe, expect, test } from "bun:test";
import type { SessionConfig } from "@conducted/protocol";
import { codexSettingsChanged, codexThreadSettings } from "./thread-settings.ts";

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

	test("a missing or none personality sends nothing, the other tones are kept", () => {
		expect(codexThreadSettings(config()).personality).toBeUndefined();
		expect(codexThreadSettings(config({ codexPersonality: "none" })).personality).toBeUndefined();
		expect(codexThreadSettings(config({ codexPersonality: "pragmatic" })).personality).toBe(
			"pragmatic",
		);
		expect(codexThreadSettings(config({ codexPersonality: "friendly" })).personality).toBe(
			"friendly",
		);
	});
});

describe("AGENT-16 Codex settings change rule", () => {
	test("the defaults mean no change and none equals a missing personality", () => {
		expect(codexSettingsChanged(config(), config())).toBe(false);
		expect(codexSettingsChanged(config(), config({ codexPersonality: "none" }))).toBe(false);
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
