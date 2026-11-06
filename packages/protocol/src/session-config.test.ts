import { expect, test } from "bun:test";
import { zSessionConfig } from "./session-config.ts";

const base = {
	agent: "codex",
	model: "gpt-5",
	effort: "ultra",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: false },
};

test("Codex options and the top effort levels parse", () => {
	const config = {
		...base,
		codexPersonality: "pragmatic",
		codexApprovalPolicy: "on-request",
		codexSandboxMode: "workspace-write",
	};
	const parsed: unknown = zSessionConfig.parse(config);
	expect(parsed).toEqual(config);
	expect(zSessionConfig.parse({ ...base, agent: "claude", effort: "ultracode" }).effort).toBe(
		"ultracode",
	);
	expect(zSessionConfig.safeParse({ ...base, codexSandboxMode: "anything" }).success).toBe(false);
});

test("an ACP chat keeps its own options by id", () => {
	const config = {
		...base,
		agent: "acp",
		acpAgent: "opencode",
		acpConfig: { thought_level: "high", web_search: true },
	};
	expect(zSessionConfig.parse(config).acpConfig).toEqual({
		thought_level: "high",
		web_search: true,
	});
});

test("a config without the SetTargetBranch switch is rejected", () => {
	const { setTargetBranch: _dropped, ...appTools } = base.appTools;
	expect(zSessionConfig.safeParse({ ...base, appTools }).success).toBe(false);
});

test("a Claude chat can carry its Remote Control switch", () => {
	const config = { ...base, agent: "claude", effort: "high", remoteControl: true };
	expect(zSessionConfig.parse(config).remoteControl).toBe(true);
	expect(zSessionConfig.safeParse({ ...config, remoteControl: "yes" }).success).toBe(false);
});
