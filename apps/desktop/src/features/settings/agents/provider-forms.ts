/**
 * @feature SET-09 Agent provider forms
 * Owns: the provider choices each agent offers and how a choice maps to the stored provider setting,
 * the provider id and the environment variable its key belongs in.
 * Behaviour: ui-map.md 6, "Agents page" (Claude Code subscription, Anthropic API key, Amazon Bedrock,
 * Google Vertex AI, Codex as an API key or a ChatGPT account, Cursor API key, Custom provider);
 * services-map.md 4.2.3 (`claude_provider`, `codex_provider`, `bedrock_region`, `vertex_project_id`);
 * D033 (each key reaches only its own agent).
 * Our design choice: the subscription token is kept under the Anthropic provider because both sign
 * Claude Code in; the Bedrock test model is given to Claude as `ANTHROPIC_MODEL`; a custom provider's
 * optional workspace ID is passed as the workspace variable the agent's family uses. Each choice stores
 * its own setting value, and the dialog shows the stored choice: an empty `claude_provider` is the
 * standard sign-in, the Claude Code subscription, and "anthropic" is the Anthropic API key. An empty
 * `codex_provider` is the ChatGPT account. The launch passes only the chosen credential
 * (core/container.ts, LEFT_OUT_BY_SIGN_IN).
 * Test first: the provider-choice test in AgentProvidersDialog.set-09.test.tsx.
 */
import type { AcpAgent, AgentKind } from "@conducted/shared";

export type ProviderChoiceId =
	| "subscription"
	| "anthropic"
	| "bedrock"
	| "vertex"
	| "openai"
	| "chatgpt"
	| "cursor"
	| "custom";

export interface ProviderChoice {
	id: ProviderChoiceId;
	label: string;
	/** The value written to the provider setting, when the agent has one. */
	settingValue: string | null;
}

const CLAUDE_CHOICES: readonly ProviderChoice[] = [
	{ id: "subscription", label: "Claude Code subscription", settingValue: "" },
	{ id: "anthropic", label: "Anthropic API key", settingValue: "anthropic" },
	{ id: "bedrock", label: "Amazon Bedrock", settingValue: "bedrock" },
	{ id: "vertex", label: "Google Vertex AI", settingValue: "vertex" },
	{ id: "custom", label: "Custom provider", settingValue: "custom" },
];

const CODEX_CHOICES: readonly ProviderChoice[] = [
	{ id: "chatgpt", label: "ChatGPT account", settingValue: "" },
	{ id: "openai", label: "OpenAI API key", settingValue: "openai" },
	{ id: "custom", label: "Custom provider", settingValue: "custom" },
];

const CURSOR_CHOICES: readonly ProviderChoice[] = [
	{ id: "cursor", label: "Cursor API key", settingValue: null },
];

const ACP_CHOICES: readonly ProviderChoice[] = [
	{ id: "custom", label: "Custom provider", settingValue: null },
];

/** The providers the dialog offers for one agent program. */
export function providerChoices(agent: AgentKind, acpAgent?: AcpAgent): readonly ProviderChoice[] {
	if (agent === "claude") return CLAUDE_CHOICES;
	if (agent === "codex") return CODEX_CHOICES;
	if (agent === "cursor") return CURSOR_CHOICES;
	return acpAgent === undefined ? [] : ACP_CHOICES;
}

/** The setting that records the chosen provider, when the agent has one. */
export function providerSettingKey(agent: AgentKind): "claude_provider" | "codex_provider" | null {
	if (agent === "claude") return "claude_provider";
	if (agent === "codex") return "codex_provider";
	return null;
}

/** The provider id stored on a key row. The subscription token uses the Anthropic provider. */
export function providerIdFor(choice: ProviderChoiceId): string {
	return choice === "subscription" ? "anthropic" : choice;
}

/** The environment variable the main key field of a choice belongs in. */
export function keyEnvVarFor(agent: AgentKind, choice: ProviderChoiceId): string {
	if (choice === "subscription") return "CLAUDE_CODE_OAUTH_TOKEN";
	if (choice === "anthropic") return "ANTHROPIC_API_KEY";
	if (choice === "openai") return "OPENAI_API_KEY";
	if (choice === "cursor") return "CURSOR_API_KEY";
	if (choice === "custom") {
		if (agent === "claude") return "ANTHROPIC_API_KEY";
		if (agent === "cursor") return "CURSOR_API_KEY";
		return "OPENAI_API_KEY";
	}
	return "";
}

/** The environment variable a custom provider's optional workspace ID belongs in. */
export function workspaceIdEnvVarFor(agent: AgentKind): string {
	if (agent === "claude") return "ANTHROPIC_WORKSPACE_ID";
	if (agent === "cursor") return "CURSOR_WORKSPACE_ID";
	if (agent === "acp") return "OPENCODE_WORKSPACE_ID";
	return "OPENAI_ORG_ID";
}

/** Which choice to show first: the one the provider setting stores. */
export function initialProviderChoice(agent: AgentKind, setting: string): ProviderChoiceId {
	const chosen = setting.trim().toLowerCase();
	const stored = providerChoices(agent).find((choice) => choice.settingValue === chosen);
	if (stored !== undefined) return stored.id;
	if (agent === "cursor") return "cursor";
	if (agent === "acp") return "custom";
	// A value the dialog does not offer (set in a settings file) shows the standard sign-in.
	return agent === "claude" ? "subscription" : "chatgpt";
}
