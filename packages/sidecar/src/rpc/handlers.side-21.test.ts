import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { buildHandlers, type HandlerDeps } from "./handlers.ts";

const model: ModelInfo = {
	id: "claude-sonnet",
	label: "Sonnet",
	status: "picker",
	isNew: false,
	isDefault: true,
	efforts: [],
	defaultEffort: "medium",
	effortAxis: "effort",
	liveEffortChange: false,
	supportsFastMode: false,
};

const deps = (): HandlerDeps => ({
	sessions: {
		sendMessage: async () => ({ deliveredAs: "new_turn" }),
		cancel: async () => ({ wasWorking: false, droppedMessageIds: [] }),
		warmAgent: async () => ({}),
		resetAgent: async () => ({}),
		updateConfig: async () => ({ applied: "live" }),
		setAutoApproveEdits: async () => ({}),
		getSessionStatus: async () => ({ known: false }),
		answerInteraction: async () => ({ accepted: false, superseded: true }),
		listAcpConfigOptions: async () => ok({ options: [] }),
		setAcpConfigOption: async () => ok({ options: [] }),
		onAppAttached: () => {},
		shutdown: async () => {},
	},
	outbox: {
		open: async () => ok([]),
		append: async () => ok([]),
		acknowledge: async () => ok(undefined),
		pending: () => [],
		sessionsWithPending: () => [],
		sweepIdle: async () => ok(0),
	},
	models: {
		list: async () => ok([]),
		validate: async () => ok(model),
		invalidate: () => {},
	},
	agents: {
		detectAll: async () => [],
		startLogin: async () => ok({ loginId: "login-1", instructions: "Sign in" }),
		finishLogin: async () => ok({ outcome: "signed_in" }),
		cancelLogin: async () => ok(undefined),
	},
	slashCommands: { list: async () => ok([]) },
	mcpServers: { list: async () => ok([]) },
	usage: { contextUsage: async () => ok({ usedTokens: 0, windowTokens: 1, rateLimits: [] }) },
	shellEnv: {
		get: async () => ok({ shell: "/bin/zsh", path: "/usr/bin", env: {}, providerSecrets: {} }),
		refresh: async () => ok({ shell: "/bin/zsh", path: "/usr/bin", env: {}, providerSecrets: {} }),
	},
	utilityPrompt: { run: async () => ok({ text: "" }) },
	setLogLevel: () => {},
});

describe("SIDE-21 agent providers request", () => {
	test("SIDE-21 listAgentProviders answers with the agent's own key variables", async () => {
		const handlers = buildHandlers(deps());

		const answered = await handlers.requests.listAgentProviders({ agent: "codex" });

		expect(answered).toEqual(
			ok({
				providers: [
					{ id: "openai", label: "OpenAI API key", keyEnvVars: ["OPENAI_API_KEY"] },
					{
						id: "custom",
						label: "Custom provider",
						keyEnvVars: ["OPENAI_API_KEY", "OPENAI_ORG_ID"],
					},
				],
			}),
		);
	});

	test("SIDE-21 listAgentProviders answers for an ACP adapter too", async () => {
		const handlers = buildHandlers(deps());

		const answered = await handlers.requests.listAgentProviders({
			agent: "acp",
			acpAgent: "pi",
		});

		expect("ok" in answered && answered.ok).toBe(true);
	});
});
