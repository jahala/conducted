import { describe, expect, test } from "bun:test";
import type { AgentLaunch, WorkspaceContext } from "@conducted/protocol";
import type { Result, SessionId, WorkspaceId } from "@conducted/shared";
import { agentProviders, buildAgentEnvironment, claudeProviderEnvironment } from "./launch-env.ts";

const workspace: WorkspaceContext = {
	workspaceId: "w1" as WorkspaceId,
	workspaceName: "lisbon",
	workspacePath: "/work/lisbon",
	repoRootPath: "/repos/conducted",
	targetBranch: "origin/main",
	placeholderBranch: false,
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

describe("SET-09 provider keys reach their own agent", () => {
	test("set_09_a_claude_subscription_token_reaches_claude", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					providerKeys: {
						CLAUDE_CODE_OAUTH_TOKEN: { value: "oauth-token", source: "entered" },
					},
				}),
			}),
		);

		expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-token");
	});

	test("set_09_bedrock_session_keys_reach_claude", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					provider: "bedrock",
					providerKeys: {
						AWS_BEARER_TOKEN_BEDROCK: { value: "bedrock-key", source: "entered" },
						AWS_ACCESS_KEY_ID: { value: "access", source: "entered" },
						AWS_SECRET_ACCESS_KEY: { value: "secret", source: "entered" },
						AWS_SESSION_TOKEN: { value: "session", source: "entered" },
						ANTHROPIC_MODEL: { value: "test-model", source: "entered" },
					},
				}),
			}),
		);

		expect(env.AWS_BEARER_TOKEN_BEDROCK).toBe("bedrock-key");
		expect(env.AWS_ACCESS_KEY_ID).toBe("access");
		expect(env.AWS_SECRET_ACCESS_KEY).toBe("secret");
		expect(env.AWS_SESSION_TOKEN).toBe("session");
		expect(env.ANTHROPIC_MODEL).toBe("test-model");
		expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
	});

	test("set_09_a_custom_provider_receives_its_entered_keys", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					provider: "custom",
					providerKeys: {
						ANTHROPIC_API_KEY: { value: "custom-key", source: "entered" },
						ANTHROPIC_WORKSPACE_ID: { value: "workspace-1", source: "entered" },
					},
				}),
			}),
		);

		expect(env.ANTHROPIC_API_KEY).toBe("custom-key");
		expect(env.ANTHROPIC_WORKSPACE_ID).toBe("workspace-1");
		expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
	});

	test("set_09_a_built_in_provider_still_rejects_another_agent_key", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					provider: "anthropic",
					providerKeys: {
						ANTHROPIC_API_KEY: { value: "anthropic-key", source: "entered" },
						CURSOR_API_KEY: { value: "cursor-key", source: "entered" },
					},
				}),
			}),
		);

		expect(env.ANTHROPIC_API_KEY).toBe("anthropic-key");
		expect(env.CURSOR_API_KEY).toBeUndefined();
	});

	test("set_09_a_custom_codex_provider_passes_the_optional_workspace_id", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "codex",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					provider: "custom",
					providerKeys: {
						OPENAI_API_KEY: { value: "custom-key", source: "entered" },
						OPENAI_ORG_ID: { value: "workspace-1", source: "entered" },
					},
				}),
			}),
		);

		expect(env.OPENAI_API_KEY).toBe("custom-key");
		expect(env.OPENAI_ORG_ID).toBe("workspace-1");
	});

	test("set_09_the_provider_lists_name_the_subscription_bedrock_and_custom_forms", () => {
		const claude = agentProviders("claude");
		expect(claude.find((entry) => entry.id === "anthropic")?.keyEnvVars).toContain(
			"CLAUDE_CODE_OAUTH_TOKEN",
		);
		expect(claude.find((entry) => entry.id === "bedrock")?.keyEnvVars).toEqual(
			expect.arrayContaining(["AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK", "ANTHROPIC_MODEL"]),
		);
		expect(claude.map((entry) => entry.id)).toContain("custom");
		expect(must(claudeProviderEnvironment("custom"))).toEqual({});
		expect(claudeProviderEnvironment("mystery").ok).toBe(false);
	});
});
