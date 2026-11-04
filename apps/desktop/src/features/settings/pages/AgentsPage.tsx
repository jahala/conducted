/**
 * @feature SET-03 Agents settings page
 * Owns: the Agents page of Settings: for each agent program, whether it is installed, its version
 * and path, whether it is signed in, and the sign-in action. It also holds the MCP servers
 * section.
 * Behaviour: ui-map.md 6, "Agents" table and "Agents page" (provider search, one card per
 * provider: Claude Code, Codex, Cursor, OpenCode and Pi; states "Loaded from env", "API key
 * configured", "Validation failed", "Recommended"); decision 7 of the scaffold plan (agent programs
 * come from the user's machine first).
 * Data: useAgentInstalls() (AgentInstall: agent, acpAgent, installed, path, version,
 * authenticated), useActions().agents (login, refresh).
 * Children: agents/AgentCard, agents/AgentLoginDialog, agents/McpServersSection.
 * Left out: custom providers and API-key brokering (Conductor stores keys per provider; we use each
 * program's own login), Bedrock and Vertex fields, "Use Claude Code with Chrome", the download
 * manager. Open question: whether to offer API-key entry at all, since the Environment page can
 * set the variables the programs read.
 * Must handle: loading and error, a provider filter with no match ("No providers match"), nothing
 * installed (the page leads with install help), a program found but failing its version check
 * ("Validation failed" with the stderr), a sign-in in progress, and a refresh after the user
 * installs a program in a terminal.
 * Test first: with Codex not installed its card shows install help and no sign-in button.
 */
import { notImplemented } from "@conducted/shared";

export function AgentsPage(): never {
	return notImplemented("SET-03");
}
