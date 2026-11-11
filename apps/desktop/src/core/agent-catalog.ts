/**
 * @feature SET-03 Agent catalogue: installs, models, slash commands, sign-in
 * @feature SET-08 Sync agent configs between Claude Code and Codex
 * Owns: the agent list, display names, catalogue keys and stored-key parsing that the Agents page
 * and the model pickers share, and the category order the config sync dialog shows. These are the
 * pure parts of the agent catalogue; the service that talks to the sidecar imports them.
 * Behaviour: other-runners.md 5 (model catalog, detection), services-map.md 5B.5 (model catalog and
 * favourites), ui-map.md 6 (Agents page), D098 (Pi is ours).
 */
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { ACP_AGENTS, AGENT_KINDS } from "@conducted/shared";
import type { ConfigSyncCategory } from "./model.ts";

export const agentKey = (agent: AgentKind, acpAgent?: AcpAgent): string =>
	acpAgent === undefined ? agent : `${agent}:${acpAgent}`;

/** The name the user sees. ACP agents share one agent kind but keep their own names. */
export function agentDisplayName(choice: { agent: AgentKind; acpAgent?: AcpAgent }): string {
	if (choice.agent === "claude") return "Claude Code";
	if (choice.agent === "codex") return "Codex";
	if (choice.agent === "cursor") return "Cursor";
	if (choice.acpAgent === "pi") return "Pi";
	if (choice.acpAgent === "opencode") return "OpenCode";
	return "ACP agent";
}

/**
 * Every agent the app can run, in Conductor's order (Pi is ours, D098). The composer's picker,
 * the loadout and the review model picker share it, so a new agent is added in one place.
 */
export const AGENT_CHOICES: readonly { agent: AgentKind; acpAgent?: AcpAgent }[] = [
	{ agent: "claude" },
	{ agent: "codex" },
	{ agent: "cursor" },
	{ agent: "acp", acpAgent: "opencode" },
	{ agent: "acp", acpAgent: "pi" },
];

/**
 * Reads the agent a stored `agentKey` names, or null when it names no agent this app can run.
 * The review model stores its agent beside its model, so a chat starts with the agent that offers
 * the model rather than with the default chat's.
 */
export function parseAgentKey(key: string): { agent: AgentKind; acpAgent?: AcpAgent } | null {
	const parts = key.split(":");
	if (parts.length === 1) {
		const agent = parts[0] as AgentKind;
		return agent !== "acp" && AGENT_KINDS.includes(agent) ? { agent } : null;
	}
	if (parts.length !== 2) return null;
	const [agent, acpAgent] = parts;
	if (agent !== "acp" || !ACP_AGENTS.includes(acpAgent as AcpAgent)) return null;
	return { agent: "acp", acpAgent: acpAgent as AcpAgent };
}

/** The category order the sync dialog shows (SET-08). */
export const CONFIG_SYNC_CATEGORIES: readonly ConfigSyncCategory[] = [
	"mcp_servers",
	"slash_commands",
	"skills",
];
