/**
 * @feature SIDE-16 Slash commands and MCP server listing
 * Owns: answering listSlashCommands and listMcpServers for any agent.
 * Behaviour: research/conductor/claude-runner.md section 7 (supported commands come from the live
 * query object; a chat that is not live uses a throwaway metadata query) and other-runners.md
 * section 6 (Cursor returns no commands and no MCP servers; OpenCode lists MCP servers through its
 * own hook).
 * Must handle:
 *  - no live session for the agent: start a throwaway metadata query, ask, and stop it again
 *  - the cached answer: keep the last good list per workspace so the "/" menu opens at once
 *  - an agent without the capability (runner.capabilities.slashCommands false): empty list
 *  - the throwaway query leaves no process behind, even when the ask fails
 * Test first: for an agent whose capabilities.slashCommands is false the lister returns an empty
 * list without calling the runner.
 */
import type { SlashCommand } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { type AppError, notImplemented, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { RunnerRegistry } from "../runners/registry.ts";

export type McpServerStatusView = {
	name: string;
	status: "connected" | "failed" | "needs_auth" | "pending" | "disabled";
	toolCount?: number;
};

export interface SlashCommandLister {
	list(
		agent: AgentKind,
		acpAgent: AcpAgent | undefined,
		workspacePath: string,
	): Promise<Result<SlashCommand[], AppError>>;
}

export interface McpServerLister {
	list(
		agent: AgentKind,
		acpAgent: AcpAgent | undefined,
		workspacePath: string,
	): Promise<Result<McpServerStatusView[], AppError>>;
}

export class RunnerSlashCommandLister implements SlashCommandLister {
	constructor(protected readonly deps: { runners: RunnerRegistry; logger: Logger }) {}

	list(
		_agent: AgentKind,
		_acpAgent: AcpAgent | undefined,
		_workspacePath: string,
	): Promise<Result<SlashCommand[], AppError>> {
		return notImplemented("SIDE-16");
	}
}

export class RunnerMcpServerLister implements McpServerLister {
	constructor(protected readonly deps: { runners: RunnerRegistry; logger: Logger }) {}

	list(
		_agent: AgentKind,
		_acpAgent: AcpAgent | undefined,
		_workspacePath: string,
	): Promise<Result<McpServerStatusView[], AppError>> {
		return notImplemented("SIDE-16");
	}
}
