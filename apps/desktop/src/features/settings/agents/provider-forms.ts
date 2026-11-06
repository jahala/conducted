/**
 * @feature SET-09 Agent provider forms
 * Owns: the provider choices each agent offers and how a choice maps to the stored provider setting,
 * the provider id and the environment variable its key belongs in.
 * Behaviour: ui-map.md 6, "Agents page" (Claude Code subscription, Anthropic API key, Amazon Bedrock,
 * Google Vertex AI, Codex as an API key or a ChatGPT account, Cursor API key, Custom provider);
 * services-map.md 4.2.3 (`claude_provider`, `codex_provider`, `bedrock_region`, `vertex_project_id`);
 * D033 (each key reaches only its own agent).
 * The choices, their providers and their variables come from the one agent-provider table in
 * packages/protocol (`AGENT_PROVIDER_TABLE`); this module only adds the app's setting keys. Each
 * choice stores its own setting value (the table's `launchProvider`), and the dialog shows the stored
 * choice: an empty `claude_provider` is the standard sign-in, the Claude Code subscription, and
 * "anthropic" is the Anthropic API key. An empty `codex_provider` is the ChatGPT account. The launch
 * passes only the chosen credential (core/container.ts).
 * Test first: the provider-choice test in AgentProvidersDialog.set-09.test.tsx.
 */
import { AGENT_PROVIDER_TABLE, type AgentSignIn, type SignInId } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";

/** The providers the dialog offers for one agent program. An ACP chat names its agent first. */
export function providerChoices(agent: AgentKind, acpAgent?: AcpAgent): readonly AgentSignIn[] {
	if (agent === "acp" && acpAgent === undefined) return [];
	return AGENT_PROVIDER_TABLE[agent].signIns;
}

/** The setting that records the chosen provider, when the agent has one. */
export function providerSettingKey(agent: AgentKind): "claude_provider" | "codex_provider" | null {
	if (agent === "claude") return "claude_provider";
	if (agent === "codex") return "codex_provider";
	return null;
}

function signInOf(agent: AgentKind, choice: SignInId): AgentSignIn | undefined {
	return AGENT_PROVIDER_TABLE[agent].signIns.find((entry) => entry.id === choice);
}

/** The provider id stored on a key row. The subscription token uses the Anthropic provider. */
export function providerIdFor(agent: AgentKind, choice: SignInId): string {
	return signInOf(agent, choice)?.provider ?? choice;
}

/** The environment variable the main key field of a choice belongs in; "" when it has no key. */
export function keyEnvVarFor(agent: AgentKind, choice: SignInId): string {
	return signInOf(agent, choice)?.keyEnvVars[0] ?? "";
}

/** The environment variable a custom provider's optional workspace ID belongs in. */
export function workspaceIdEnvVarFor(agent: AgentKind): string {
	return signInOf(agent, "custom")?.workspaceIdEnvVar ?? "";
}

/**
 * Which choice to show first. Cursor and ACP agents offer one choice and store no provider setting.
 * Claude and Codex show the choice their provider setting stores, and their standard sign-in when the
 * setting holds a value the dialog does not offer (set in a settings file).
 */
export function initialProviderChoice(agent: AgentKind, setting: string | null): SignInId {
	const signIns = AGENT_PROVIDER_TABLE[agent].signIns;
	const standard = signIns.find((entry) => entry.launchProvider === "") ?? signIns[0];
	if (standard === undefined || standard.launchProvider === null) return signIns[0]?.id ?? "custom";
	const chosen = setting?.trim().toLowerCase();
	return signIns.find((entry) => entry.launchProvider === chosen)?.id ?? standard.id;
}
