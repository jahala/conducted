import { describe, expect, test } from "bun:test";
import {
	type AgentLaunch,
	agentProviders,
	opencodeProviders,
	type WorkspaceContext,
} from "@conducted/protocol";
import type { Result, SessionId, WorkspaceId } from "@conducted/shared";
import { buildAgentEnvironment } from "../launch-env.ts";

const workspace: WorkspaceContext = {
	workspaceId: "w1" as WorkspaceId,
	workspaceName: "lisbon",
	workspacePath: "/work/lisbon",
	repoRootPath: "/repos/conducted",
	targetBranch: "origin/main",
	placeholderBranch: false,
	host: { kind: "local" },
	port: 5100,
};
const sessionId = "s1" as SessionId;

const launch = (over: Partial<AgentLaunch> = {}): AgentLaunch => ({
	env: {},
	providerKeys: {},
	...over,
});

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

describe("SET-10 OpenCode provider catalogue", () => {
	test("set_10_lists_conductors_97_entries_from_302_ai_to_z_ai", () => {
		const providers = opencodeProviders();
		// Conductor's table holds 97 entries, one per key variable (bundle main-BE1h_1MP.js, `_T`).
		expect(providers).toHaveLength(97);
		const labels = providers.map((provider) => provider.label);
		expect(labels).toContain("302.AI");
		expect(labels).toContain("Z.AI / Z.AI Coding Plan / Zhipu AI Coding Plan / Zhipu AI");
		expect(providers[0]).toEqual({ id: "302ai", label: "302.AI", keyEnvVars: ["302AI_API_KEY"] });
		expect(providers.at(-1)).toEqual({
			id: "zai",
			label: "Z.AI / Z.AI Coding Plan / Zhipu AI Coding Plan / Zhipu AI",
			keyEnvVars: ["ZHIPU_API_KEY"],
		});
		// A variable several providers read is one entry, so its key is stored once.
		expect(providers.find((provider) => provider.keyEnvVars.includes("GITHUB_TOKEN"))).toEqual({
			id: "github-copilot",
			label: "GitHub Copilot / GitHub Models",
			keyEnvVars: ["GITHUB_TOKEN"],
		});
		const variables = providers.flatMap((provider) => provider.keyEnvVars);
		expect(new Set(variables).size).toBe(variables.length);
	});

	test("set_10_every_provider_has_a_unique_id_and_the_variables_its_key_goes_in", () => {
		const providers = opencodeProviders();
		const ids = providers.map((provider) => provider.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const provider of providers) {
			expect(provider.id.trim()).not.toBe("");
			expect(provider.label.trim()).not.toBe("");
			expect(provider.keyEnvVars.length).toBeGreaterThan(0);
			// Conductor's names include ones that start with a digit, such as 302AI_API_KEY.
			for (const name of provider.keyEnvVars) expect(name).toMatch(/^[A-Z0-9][A-Z0-9_]*$/);
		}
		const deepseek = providers.find((provider) => provider.id === "deepseek");
		expect(deepseek?.keyEnvVars).toEqual(["DEEPSEEK_API_KEY"]);
	});

	test("set_10_hands_out_a_copy_that_a_caller_cannot_change", () => {
		const first = opencodeProviders();
		first.pop();
		first[0]?.keyEnvVars.push("NOT_A_KEY");

		const second = opencodeProviders();
		expect(second).toHaveLength(97);
		expect(second[0]?.keyEnvVars).toEqual(["302AI_API_KEY"]);
	});

	test("set_10_opencode_and_pi_receive_the_catalogue_plus_the_custom_provider", () => {
		const opencode = agentProviders("acp", "opencode");
		const pi = agentProviders("acp", "pi");
		expect(pi.map((provider) => provider.id)).toEqual(opencode.map((provider) => provider.id));
		expect(opencode.find((provider) => provider.id === "deepseek")?.keyEnvVars).toEqual([
			"DEEPSEEK_API_KEY",
		]);
		expect(opencode.at(-1)).toMatchObject({ id: "custom", label: "Custom provider" });
	});
});

describe("SET-10 OpenCode provider keys reach the agent", () => {
	test("set_10_passes_a_catalogue_provider_key_and_leaves_an_unlisted_key_out", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "acp",
				acpAgent: "opencode",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					providerKeys: {
						DEEPSEEK_API_KEY: { value: "deepseek-key", source: "entered" },
						NOT_A_PROVIDER_KEY: { value: "not-a-key", source: "entered" },
					},
				}),
			}),
		);

		expect(env.DEEPSEEK_API_KEY).toBe("deepseek-key");
		expect(env.NOT_A_PROVIDER_KEY).toBeUndefined();
	});
});
