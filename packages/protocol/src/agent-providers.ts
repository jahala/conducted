/**
 * @feature SET-09 Agent provider forms
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys
 * Owns: the one agent-provider table. For each agent program: its name in messages, the variable its
 * base URL goes in, the ways it signs in (the Providers dialog's choices) with the provider each
 * choice stores its keys under and the environment variables those keys go in, and Claude's
 * routing variables. The desktop's dialog and launch read it, and so do the sidecar's key filter,
 * routing and `listAgentProviders` answer.
 * Behaviour: ui-map.md 6, "Agents page" (Claude Code subscription, Anthropic API key, Amazon Bedrock,
 * Google Vertex AI, Codex as an API key or a ChatGPT account, Cursor API key, Custom provider);
 * services-map.md 4.2.3 (`claude_provider`, `codex_provider`); native-and-sidecar-map.md B4 (Claude
 * routes to Bedrock, Vertex, Foundry and Mantle); other-runners.md 2.1 (`OPENAI_BASE_URL` for Codex);
 * D033 (each key reaches only its own agent).
 * Our design choice: the subscription token is kept under the Anthropic provider because both sign
 * Claude Code in; the Bedrock test model is given to Claude as `ANTHROPIC_MODEL`; a custom provider's
 * optional workspace ID goes in the workspace variable the agent's family uses. Foundry and Mantle
 * route but have no key form, because the research names no key variables for them.
 * Must handle: one variable used by two sign-ins of one provider (listed once for the provider), an
 * agent with no provider setting (Cursor, OpenCode and Pi), and lists a caller may change (each call
 * hands out a copy).
 * Test first: the provider list groups the sign-ins by provider, as listAgentProviders answers.
 */
import type { AgentKind } from "@conducted/shared";
import { opencodeProviders } from "./opencode-providers.ts";
import type { AgentProvider } from "./rpc.ts";

/** The choices of the Providers dialog, across every agent. */
export type SignInId =
	| "subscription"
	| "anthropic"
	| "bedrock"
	| "vertex"
	| "chatgpt"
	| "openai"
	| "cursor"
	| "custom";

/** One way an agent signs in: a choice in the Providers dialog. */
export interface AgentSignIn {
	id: SignInId;
	label: string;
	/** The provider the choice's keys are stored under and listed with. */
	provider: string;
	/**
	 * The value the launch's `provider` carries for this choice, which the app stores as the agent's
	 * provider setting. "" is the agent's standard sign-in. null: the agent has no provider setting.
	 */
	launchProvider: string | null;
	/** The variables the choice's keys go in. The first is the main key field. */
	keyEnvVars: readonly string[];
	/** A custom provider's optional workspace ID variable. */
	workspaceIdEnvVar?: string;
	/** Claude only: the variable set to "1" to route Claude through this provider. */
	routingEnvVar?: string;
}

/** Everything the app and the sidecar know about one agent's providers. */
export interface AgentProviderFacts {
	/** The agent's name in messages. */
	name: string;
	/** Missing when the agent has no base URL setting. */
	baseUrlEnvVar?: string;
	signIns: readonly AgentSignIn[];
	/**
	 * Providers the agent chooses between in its own config (OpenCode's catalogue). Every key the
	 * user stored for such an agent reaches it, since the app cannot know which one the config picks.
	 */
	configProviders?: readonly AgentProvider[];
	/** Claude only: providers Claude can be routed to that have no key form of their own. */
	routingOnly?: readonly { id: string; routingEnvVar: string }[];
}

/** The variables of Claude's Bedrock form: one Bedrock API key, or AWS access keys, and a test model. */
export const BEDROCK_ENV = {
	apiKey: "AWS_BEARER_TOKEN_BEDROCK",
	accessKeyId: "AWS_ACCESS_KEY_ID",
	secretAccessKey: "AWS_SECRET_ACCESS_KEY",
	sessionToken: "AWS_SESSION_TOKEN",
	testModel: "ANTHROPIC_MODEL",
} as const;

const CUSTOM_LABEL = "Custom provider";

export const AGENT_PROVIDER_TABLE: Readonly<Record<AgentKind, AgentProviderFacts>> = {
	claude: {
		name: "Claude Code",
		baseUrlEnvVar: "ANTHROPIC_BASE_URL",
		signIns: [
			{
				id: "subscription",
				label: "Claude Code subscription",
				provider: "anthropic",
				launchProvider: "",
				keyEnvVars: ["CLAUDE_CODE_OAUTH_TOKEN"],
			},
			{
				id: "anthropic",
				label: "Anthropic API key",
				provider: "anthropic",
				launchProvider: "anthropic",
				keyEnvVars: ["ANTHROPIC_API_KEY"],
			},
			{
				id: "bedrock",
				label: "Amazon Bedrock",
				provider: "bedrock",
				launchProvider: "bedrock",
				keyEnvVars: [
					BEDROCK_ENV.apiKey,
					BEDROCK_ENV.accessKeyId,
					BEDROCK_ENV.secretAccessKey,
					BEDROCK_ENV.sessionToken,
					BEDROCK_ENV.testModel,
				],
				routingEnvVar: "CLAUDE_CODE_USE_BEDROCK",
			},
			{
				id: "vertex",
				label: "Google Vertex AI",
				provider: "vertex",
				launchProvider: "vertex",
				keyEnvVars: ["GOOGLE_APPLICATION_CREDENTIALS"],
				routingEnvVar: "CLAUDE_CODE_USE_VERTEX",
			},
			{
				id: "custom",
				label: CUSTOM_LABEL,
				provider: "custom",
				launchProvider: "custom",
				keyEnvVars: ["ANTHROPIC_API_KEY"],
				workspaceIdEnvVar: "ANTHROPIC_WORKSPACE_ID",
			},
		],
		routingOnly: [
			{ id: "foundry", routingEnvVar: "CLAUDE_CODE_USE_FOUNDRY" },
			{ id: "mantle", routingEnvVar: "CLAUDE_CODE_USE_MANTLE" },
		],
	},
	codex: {
		name: "Codex",
		baseUrlEnvVar: "OPENAI_BASE_URL",
		signIns: [
			{
				id: "chatgpt",
				label: "ChatGPT account",
				provider: "openai",
				launchProvider: "",
				keyEnvVars: [],
			},
			{
				id: "openai",
				label: "OpenAI API key",
				provider: "openai",
				launchProvider: "openai",
				keyEnvVars: ["OPENAI_API_KEY"],
			},
			{
				id: "custom",
				label: CUSTOM_LABEL,
				provider: "custom",
				launchProvider: "custom",
				keyEnvVars: ["OPENAI_API_KEY"],
				workspaceIdEnvVar: "OPENAI_ORG_ID",
			},
		],
	},
	cursor: {
		name: "Cursor",
		signIns: [
			{
				id: "cursor",
				label: "Cursor API key",
				provider: "cursor",
				launchProvider: null,
				keyEnvVars: ["CURSOR_API_KEY"],
			},
		],
	},
	acp: {
		name: "The OpenCode or Pi program",
		// OpenCode and Pi both read the OpenCode catalogue (SET-10), plus a custom provider.
		signIns: [
			{
				id: "custom",
				label: CUSTOM_LABEL,
				provider: "custom",
				launchProvider: null,
				keyEnvVars: ["OPENAI_API_KEY"],
				workspaceIdEnvVar: "OPENCODE_WORKSPACE_ID",
			},
		],
		configProviders: opencodeProviders(),
	},
};

/** Every variable a sign-in's keys go in: its key variables, then its workspace ID variable. */
export function signInEnvVars(signIn: AgentSignIn): string[] {
	return signIn.workspaceIdEnvVar === undefined
		? [...signIn.keyEnvVars]
		: [...signIn.keyEnvVars, signIn.workspaceIdEnvVar];
}

/**
 * The providers an agent can use and the variables their keys go in, as `listAgentProviders`
 * answers: the agent's config providers, then its sign-ins grouped by provider. A provider is named
 * by its own sign-in when it has one (Anthropic by "Anthropic API key"). Hands out a fresh copy.
 * OpenCode and Pi share one list.
 */
export function agentProviders(agent: AgentKind, _acpAgent?: string): AgentProvider[] {
	const facts = AGENT_PROVIDER_TABLE[agent];
	const listed: AgentProvider[] = (facts.configProviders ?? []).map((provider) => ({
		...provider,
		keyEnvVars: [...provider.keyEnvVars],
	}));
	const grouped: AgentProvider[] = [];
	for (const signIn of facts.signIns) {
		const existing = grouped.find((provider) => provider.id === signIn.provider);
		if (existing === undefined) {
			grouped.push({ id: signIn.provider, label: signIn.label, keyEnvVars: signInEnvVars(signIn) });
			continue;
		}
		if (signIn.id === signIn.provider) existing.label = signIn.label;
		for (const name of signInEnvVars(signIn)) {
			if (!existing.keyEnvVars.includes(name)) existing.keyEnvVars.push(name);
		}
	}
	return [...listed, ...grouped];
}

/** The provider values Claude takes, in table order, with the routing variable each one sets. */
export function claudeRoutes(): { id: string; routingEnvVar?: string }[] {
	const routes: { id: string; routingEnvVar?: string }[] = [];
	for (const signIn of AGENT_PROVIDER_TABLE.claude.signIns) {
		if (routes.some((route) => route.id === signIn.provider)) continue;
		routes.push(
			signIn.routingEnvVar === undefined
				? { id: signIn.provider }
				: { id: signIn.provider, routingEnvVar: signIn.routingEnvVar },
		);
	}
	for (const route of AGENT_PROVIDER_TABLE.claude.routingOnly ?? []) routes.push({ ...route });
	return routes;
}
