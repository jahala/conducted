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
 * Our design choice: MCP listing is read from the Runner's optional listMcpServers operation.
 * When a capable runner has no such operation the caller gets a typed error instead of a fake empty
 * list. Claude and Codex, the capable runners today, both implement it.
 * Our design choice: a runner reports where a command came from when its agent says so. A command
 * an agent does not label falls back to MCP for an "mcp__" name and to builtin otherwise. An
 * unlabelled Codex entry is a skill; any other unlabelled entry is a command.
 */
import type { SlashCommand } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { type AppError, appError, asAppError, err, ok, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { type RunnerRegistry, selectorKey } from "../runners/registry.ts";
import type { McpServerView, RunnerSlashCommand } from "../runners/runner.ts";

/** The runner could not list slash commands. */
export const SLASH_COMMANDS_FAILED = "slash_commands_failed";
/** A runner that declares the MCP capability has no listMcpServers operation. */
export const MCP_LIST_UNSUPPORTED = "mcp_list_unsupported";
/** The runner could not list MCP servers. */
export const MCP_LIST_FAILED = "mcp_list_failed";

/** One MCP server's status, in the protocol's own server shape. */
export type McpServerStatusView = McpServerView;

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

/** The runner's list as protocol commands, keeping the source and kind the runner reported. */
function toSlashCommands(
	agent: AgentKind,
	commands: readonly RunnerSlashCommand[],
): SlashCommand[] {
	return commands.map((entry) => {
		const command: SlashCommand = {
			name: entry.name,
			description: entry.description,
			source: entry.source ?? (entry.name.startsWith("mcp__") ? "mcp" : "builtin"),
			kind: entry.kind ?? (agent === "codex" ? "skill" : "command"),
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
		const runner = found.value;
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
