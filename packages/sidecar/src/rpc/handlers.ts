/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * @feature APP-18 Chat history from Conductor
 * Owns: wiring the method tables to the modules that implement them. This is the one place that
 * knows which module answers which request. For `listSlashCommands`, a request with no
 * `workspacePath` answers from the saved list, and a request with one refreshes it (SIDE-22).
 * Behaviour: research/conductor/sessions.md section 10 (Conductor registers every method in one
 * setup function on each connection).
 * eventPersisted acknowledges the event in the write-ahead log (outbox/); setLogLevel changes the
 * root logger; setAgentPrograms replaces the program paths chosen in Settings and detects the agents
 * again when they changed (SIDE-21); compact asks the session manager to start a Codex `/compact` turn (AGENT-14);
 * the three Conductor history methods go to the history import's mapping (APP-18).
 * Must handle: every key of appToSidecarRequests and appToSidecarNotifications has a handler (the
 * type enforces it), a module's Result error is passed through so the peer can answer with its
 * JSON-RPC code, and a session request goes straight to the session manager, which decides whether
 * the chat is known.
 * Test first: the keys of the returned tables equal the keys of the protocol tables.
 */
import { agentProviders } from "@conducted/protocol";
import { err, ok } from "@conducted/shared";
import type { ConductorHistoryImports } from "../import/history-imports.ts";
import type { Logger } from "../logging/logger.ts";
import type { AgentDetector } from "../models/agent-detection.ts";
import type { AgentProgramChoices } from "../models/agent-programs.ts";
import type { ModelCatalog } from "../models/catalog.ts";
import type { CompletionsCache } from "../models/completions-cache.ts";
import type { McpServerLister, SlashCommandLister } from "../models/slash-and-mcp.ts";
import type { UsageReader } from "../models/usage.ts";
import type { EventOutbox } from "../outbox/event-outbox.ts";
import type { SessionManager } from "../session/manager.ts";
import type { UtilityPromptRunner } from "../session/utility-prompt.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import type { AppToSidecarHandlers, AppToSidecarNotificationHandlers } from "./types.ts";

export interface HandlerDeps {
	sessions: SessionManager;
	outbox: EventOutbox;
	models: ModelCatalog;
	agents: AgentDetector;
	/** The program paths chosen in Settings, which `setAgentPrograms` replaces (SIDE-21). */
	agentPrograms: AgentProgramChoices;
	slashCommands: SlashCommandLister;
	/** Saved slash-command lists for a repository, used before a workspace exists (SIDE-22). */
	completions: CompletionsCache;
	mcpServers: McpServerLister;
	usage: UsageReader;
	shellEnv: ShellEnvProvider;
	utilityPrompt: UtilityPromptRunner;
	/** The chat history import's mapping (APP-18). */
	conductorHistory: ConductorHistoryImports;
	/** Applies setLogLevel to the root logger. */
	setLogLevel(level: "error" | "warn" | "info" | "debug"): void;
	logger: Logger;
}

export function buildHandlers(deps: HandlerDeps): {
	requests: AppToSidecarHandlers;
	notifications: AppToSidecarNotificationHandlers;
} {
	return {
		requests: {
			sendMessage: (params) => deps.sessions.sendMessage(params),
			cancel: (params) => deps.sessions.cancel(params),
			warmAgent: (params) => deps.sessions.warmAgent(params),
			resetAgent: (params) => deps.sessions.resetAgent(params),
			updateConfig: (params) => deps.sessions.updateConfig(params),
			setAutoApproveEdits: (params) => deps.sessions.setAutoApproveEdits(params),
			getSessionStatus: (params) => deps.sessions.getSessionStatus(params),
			answerInteraction: (params) => deps.sessions.answerInteraction(params),
			getContextUsage: (params) => deps.usage.contextUsage(params.sessionId),
			listSlashCommands: async (params) => {
				const key = {
					repoRootPath: params.repoRootPath,
					agent: params.agent,
					acpAgent: params.acpAgent,
				};
				if (params.workspacePath === undefined) {
					const cached = await deps.completions.read(key);
					if (!cached.ok) {
						deps.logger.warn("Could not read the slash command cache", {
							code: cached.error.code,
						});
						return err(cached.error);
					}
					return ok({ commands: cached.value?.commands ?? [], fromCache: true });
				}
				const listed = await deps.slashCommands.list(
					params.agent,
					params.acpAgent,
					params.workspacePath,
					params.launch,
				);
				if (!listed.ok) {
					deps.logger.warn("Could not refresh the slash command cache; keeping the last list", {
						code: listed.error.code,
					});
					const cached = await deps.completions.read(key);
					if (cached.ok && cached.value !== null) {
						return ok({ commands: cached.value.commands, fromCache: true });
					}
					if (!cached.ok) {
						deps.logger.warn("Could not read the last slash command list", {
							code: cached.error.code,
						});
					}
					return listed;
				}
				const saved = await deps.completions.write(key, listed.value);
				if (!saved.ok) {
					deps.logger.warn("Could not save the slash command cache; keeping the last list", {
						code: saved.error.code,
					});
				}
				return ok({ commands: listed.value, fromCache: false });
			},
			listMcpServers: async (params) => {
				const listed = await deps.mcpServers.list(
					params.agent,
					params.acpAgent,
					params.workspacePath,
					params.launch,
				);
				if (!listed.ok) return listed;
				return ok({ servers: listed.value });
			},
			listModels: async (params) => {
				const listed = await deps.models.list(params.agent, params.acpAgent, params.launch);
				if (!listed.ok) return listed;
				return ok({ models: listed.value });
			},
			getAgentInstalls: async () => ok({ agents: await deps.agents.detectAll() }),
			startAgentLogin: (params) => deps.agents.startLogin(params.agent, params.acpAgent),
			finishAgentLogin: (params) => deps.agents.finishLogin(params.loginId, params.code),
			cancelAgentLogin: async (params) => {
				const cancelled = await deps.agents.cancelLogin(params.loginId);
				return cancelled.ok ? ok({}) : cancelled;
			},
			listAgentProviders: async (params) =>
				ok({ providers: agentProviders(params.agent, params.acpAgent) }),
			getShellEnv: async (params) => {
				const captured = await deps.shellEnv.get(params.workspacePath);
				if (!captured.ok) return captured;
				return ok({ shell: captured.value.shell, path: captured.value.path });
			},
			runUtilityPrompt: (params) => deps.utilityPrompt.run(params),
			indexConductorHistory: async (params) => deps.conductorHistory.index(params),
			mapConductorHistory: async (params) => deps.conductorHistory.map(params),
			closeConductorHistory: async (params) => deps.conductorHistory.close(params),
			getGoal: (params) => deps.sessions.getGoal(params),
			setGoal: (params) => deps.sessions.setGoal(params),
			changeGoal: (params) => deps.sessions.changeGoal(params),
			compact: (params) => deps.sessions.compact(params),
			listAcpConfigOptions: (params) => deps.sessions.listAcpConfigOptions(params),
			setAcpConfigOption: (params) => deps.sessions.setAcpConfigOption(params),
		},
		notifications: {
			eventPersisted: async (params) => {
				const acknowledged = await deps.outbox.acknowledge(params.sessionId, params.eventId);
				if (!acknowledged.ok) throw acknowledged.error;
			},
			setLogLevel: (params) => deps.setLogLevel(params.level),
			// New paths are probed at once, and a changed list reaches the app as agentInstallsChanged.
			setAgentPrograms: async (params) => {
				if (deps.agentPrograms.replace(params.programs)) await deps.agents.detectAll();
			},
		},
	};
}
