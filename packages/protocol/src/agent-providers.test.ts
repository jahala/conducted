import { describe, expect, test } from "bun:test";
import {
	AGENT_PROVIDER_TABLE,
	agentProviders,
	BEDROCK_ENV,
	claudeRoutes,
	signInEnvVars,
} from "./agent-providers.ts";

const signIn = (agent: keyof typeof AGENT_PROVIDER_TABLE, id: string) => {
	const found = AGENT_PROVIDER_TABLE[agent].signIns.find((entry) => entry.id === id);
	if (found === undefined) throw new Error(`${agent} has no sign-in ${id}`);
	return found;
};

describe("one agent-provider table for the sidecar and the desktop", () => {
	test("Claude's sign-ins are the Providers dialog's choices, with the variables each key goes in", () => {
		expect(
			AGENT_PROVIDER_TABLE.claude.signIns.map((entry) => [entry.id, entry.label, entry.provider]),
		).toEqual([
			["subscription", "Claude Code subscription", "anthropic"],
			["anthropic", "Anthropic API key", "anthropic"],
			["bedrock", "Amazon Bedrock", "bedrock"],
			["vertex", "Google Vertex AI", "vertex"],
			["custom", "Custom provider", "custom"],
		]);
		// The standard sign-in is the empty provider value, and the subscription token is its key.
		expect(signIn("claude", "subscription").launchProvider).toBe("");
		expect(signIn("claude", "subscription").keyEnvVars).toEqual(["CLAUDE_CODE_OAUTH_TOKEN"]);
		expect(signIn("claude", "anthropic").keyEnvVars).toEqual(["ANTHROPIC_API_KEY"]);
		expect(signIn("claude", "bedrock").keyEnvVars).toEqual([
			BEDROCK_ENV.apiKey,
			BEDROCK_ENV.accessKeyId,
			BEDROCK_ENV.secretAccessKey,
			BEDROCK_ENV.sessionToken,
			BEDROCK_ENV.testModel,
		]);
		expect(signInEnvVars(signIn("claude", "custom"))).toEqual([
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_WORKSPACE_ID",
		]);
	});

	test("Codex signs in with ChatGPT by default and takes no key for it", () => {
		expect(AGENT_PROVIDER_TABLE.codex.signIns.map((entry) => entry.id)).toEqual([
			"chatgpt",
			"openai",
			"custom",
		]);
		expect(signIn("codex", "chatgpt")).toMatchObject({ launchProvider: "", keyEnvVars: [] });
		expect(signInEnvVars(signIn("codex", "custom"))).toEqual(["OPENAI_API_KEY", "OPENAI_ORG_ID"]);
	});

	test("Cursor and the ACP agents have no provider setting", () => {
		expect(signIn("cursor", "cursor")).toMatchObject({
			launchProvider: null,
			keyEnvVars: ["CURSOR_API_KEY"],
		});
		expect(signInEnvVars(signIn("acp", "custom"))).toEqual([
			"OPENAI_API_KEY",
			"OPENCODE_WORKSPACE_ID",
		]);
		expect(signIn("acp", "custom").launchProvider).toBeNull();
	});

	test("the provider list groups the sign-ins by provider, as listAgentProviders answers", () => {
		expect(agentProviders("codex")).toEqual([
			{ id: "openai", label: "OpenAI API key", keyEnvVars: ["OPENAI_API_KEY"] },
			{ id: "custom", label: "Custom provider", keyEnvVars: ["OPENAI_API_KEY", "OPENAI_ORG_ID"] },
		]);
		const claude = agentProviders("claude");
		expect(claude.map((provider) => provider.id)).toEqual([
			"anthropic",
			"bedrock",
			"vertex",
			"custom",
		]);
		expect(claude[0]).toEqual({
			id: "anthropic",
			label: "Anthropic API key",
			keyEnvVars: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
		});
		const acp = agentProviders("acp", "opencode");
		expect(acp).toHaveLength(98);
		expect(acp[0]).toEqual({ id: "302ai", label: "302.AI", keyEnvVars: ["302AI_API_KEY"] });
		expect(acp.at(-1)).toEqual({
			id: "custom",
			label: "Custom provider",
			keyEnvVars: ["OPENAI_API_KEY", "OPENCODE_WORKSPACE_ID"],
		});
	});

	test("every variable a sign-in writes is one its provider passes to the agent", () => {
		for (const agent of ["claude", "codex", "cursor", "acp"] as const) {
			const providers = agentProviders(agent);
			const signIns = AGENT_PROVIDER_TABLE[agent].signIns;
			expect(signIns.length).toBeGreaterThan(0);
			for (const entry of signIns) {
				const provider = providers.find((listed) => listed.id === entry.provider);
				expect(provider?.keyEnvVars).toEqual(expect.arrayContaining(signInEnvVars(entry)));
			}
		}
	});

	test("Claude routes to Bedrock, Vertex, Foundry and Mantle by one variable each", () => {
		expect(claudeRoutes()).toEqual([
			{ id: "anthropic" },
			{ id: "bedrock", routingEnvVar: "CLAUDE_CODE_USE_BEDROCK" },
			{ id: "vertex", routingEnvVar: "CLAUDE_CODE_USE_VERTEX" },
			{ id: "custom" },
			{ id: "foundry", routingEnvVar: "CLAUDE_CODE_USE_FOUNDRY" },
			{ id: "mantle", routingEnvVar: "CLAUDE_CODE_USE_MANTLE" },
		]);
	});

	test("a caller cannot change the table through a list it was handed", () => {
		const first = agentProviders("claude");
		first.pop();
		first[0]?.keyEnvVars.push("NOT_A_KEY");
		expect(agentProviders("claude")).toHaveLength(4);
		expect(agentProviders("claude")[0]?.keyEnvVars).not.toContain("NOT_A_KEY");
	});
});
