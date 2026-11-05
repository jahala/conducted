/**
 * @feature SIDE-16 Slash commands and MCP server listing
 * Owns: answering listSlashCommands and listMcpServers for any agent.
 * Behaviour: research/conductor/claude-runner.md section 7 (supported commands come from the
 * runner's throwaway metadata query) and other-runners.md section 6 (Cursor returns no commands
 * and no MCP servers; the ACP and Codex runners list what they support).
 * Must handle:
 *  - an agent without the capability (runner.capabilities.slashCommands false): empty list without
 *    calling the runner
 *  - an agent without the MCP capability (runner.capabilities.mcpServers false): empty list
 *  - a runner failure: an error value that keeps an AppError's code
 *  - a runner that declares the MCP capability but has no listing operation: a typed error, never
 *    an invented empty list
 * Test first: for an agent whose capabilities.slashCommands is false the lister returns an empty
 * list without calling the runner.
 * Our design choice: the runner contract reports only name, description and argument hint. The
 * lister therefore marks entries whose name starts with "mcp__" as MCP commands, Codex's
 * skills/list entries as skills, and every other entry as a builtin command. A runner that later
 * reports its own source and kind would need a contract change.
 * Our design choice: MCP listing is read from an optional runner operation, because the Runner
 * interface has no listMcpServers method yet. When a capable runner has no such operation the
 * caller gets a typed error instead of a fake empty list.
 */
import type { SlashCommand } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { type RunnerRegistry, selectorKey } from "../runners/registry.ts";
import type { Runner } from "../runners/runner.ts";
import { asAppError } from "../util/errors.ts";

/** The runner could not list slash commands. */
export const SLASH_COMMANDS_FAILED = "slash_commands_failed";
/** The runner lists no MCP servers because the Runner contract has no such operation yet. */
export const MCP_LIST_UNSUPPORTED = "mcp_list_unsupported";
/** The runner could not list MCP servers. */
export const MCP_LIST_FAILED = "mcp_list_failed";

export type McpServerStatusView = {
	name: string;
	status: "connected" | "failed" | "needs_auth" | "pending" | "disabled";
	toolCount?: number;
};

/**
 * A runner that can report its MCP servers. The method is optional so the shared Runner interface
 * does not change; a capable runner without it produces a typed error.
 */
export interface McpListingRunner extends Runner {
	listMcpServers?(workspacePath: string): Promise<McpServerStatusView[]>;
}

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

/** The runner's list as protocol commands. Provenance is absent from the runner contract. */
function toSlashCommands(
	agent: AgentKind,
	commands: readonly { name: string; description: string; argumentHint?: string }[],
): SlashCommand[] {
	return commands.map((entry) => {
		const command: SlashCommand = {
			name: entry.name,
			description: entry.description,
			source: entry.name.startsWith("mcp__") ? "mcp" : "builtin",
			kind: agent === "codex" ? "skill" : "command",
		};
		if (entry.argumentHint !== undefined) command.argumentHint = entry.argumentHint;
		return command;
	});
}

export class RunnerSlashCommandLister implements SlashCommandLister {
	constructor(protected readonly deps: { runners: RunnerRegistry; logger: Logger }) {}

	async list(
		agent: AgentKind,
		acpAgent: AcpAgent | undefined,
		workspacePath: string,
	): Promise<Result<SlashCommand[], AppError>> {
		const found = this.deps.runners.get({ agent, acpAgent });
		if (!found.ok) return err(found.error);
		const runner = found.value;
		const key = selectorKey({ agent, acpAgent });

		if (!runner.capabilities.slashCommands) {
			this.deps.logger.debug("Agent has no slash commands", { agent: key });
			return ok([]);
		}

		try {
			const commands = await runner.listSlashCommands(workspacePath);
			this.deps.logger.debug("Listed agent slash commands", {
				agent: key,
				commands: commands.length,
			});
			return ok(toSlashCommands(agent, commands));
		} catch (cause) {
			const error = asAppError(
				SLASH_COMMANDS_FAILED,
				`Could not list slash commands for ${key}`,
				cause,
			);
			this.deps.logger.warn("Could not list agent slash commands", {
				agent: key,
				code: error.code,
			});
			return err(error);
		}
	}
}

export class RunnerMcpServerLister implements McpServerLister {
	constructor(protected readonly deps: { runners: RunnerRegistry; logger: Logger }) {}

	async list(
		agent: AgentKind,
		acpAgent: AcpAgent | undefined,
		workspacePath: string,
	): Promise<Result<McpServerStatusView[], AppError>> {
		const found = this.deps.runners.get({ agent, acpAgent });
		if (!found.ok) return err(found.error);
		const runner = found.value as McpListingRunner;
		const key = selectorKey({ agent, acpAgent });

		if (!runner.capabilities.mcpServers) {
			this.deps.logger.debug("Agent has no MCP servers", { agent: key });
			return ok([]);
		}

		const listMcpServers = runner.listMcpServers;
		if (typeof listMcpServers !== "function") {
			const error = appError(
				MCP_LIST_UNSUPPORTED,
				`The ${key} runner has no way to list MCP servers.`,
			);
			this.deps.logger.warn("Runner has no MCP listing operation", {
				agent: key,
				code: error.code,
			});
			return err(error);
		}

		try {
			const servers = await listMcpServers.call(runner, workspacePath);
			this.deps.logger.debug("Listed agent MCP servers", {
				agent: key,
				servers: servers.length,
			});
			return ok(servers);
		} catch (cause) {
			const error = asAppError(MCP_LIST_FAILED, `Could not list MCP servers for ${key}`, cause);
			this.deps.logger.warn("Could not list agent MCP servers", {
				agent: key,
				code: error.code,
			});
			return err(error);
		}
	}
}
