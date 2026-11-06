/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: wiring the method tables to the modules that implement them. This is the one place that
 * knows which module answers which request.
 * Behaviour: research/conductor/sessions.md section 10 (Conductor registers every method in one
 * setup function on each connection).
 * eventPersisted acknowledges the event in the write-ahead log (outbox/); setLogLevel changes the
 * root logger; compact asks the session manager to start a Codex `/compact` turn (AGENT-14).
 * Must handle: every key of appToSidecarRequests and appToSidecarNotifications has a handler (the
 * type enforces it), a module's Result error is passed through so the peer can answer with its
 * JSON-RPC code, and a session request goes straight to the session manager, which decides whether
 * the chat is known.
 * Test first: the keys of the returned tables equal the keys of the protocol tables.
 * Our design choice: the methods owned by other features call notImplemented with that feature's
 * id, so an unbuilt method answers -32001 instead of pretending to work.
 */
import { notImplemented, ok } from "@conducted/shared";
import type { AgentDetector } from "../models/agent-detection.ts";
import type { ModelCatalog } from "../models/catalog.ts";
import type { McpServerLister, SlashCommandLister } from "../models/slash-and-mcp.ts";
import type { UsageReader } from "../models/usage.ts";
import type { EventOutbox } from "../outbox/event-outbox.ts";
import { agentProviders } from "../runners/launch-env.ts";
import type { SessionManager } from "../session/manager.ts";
import type { UtilityPromptRunner } from "../session/utility-prompt.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import type { AppToSidecarHandlers, AppToSidecarNotificationHandlers } from "./types.ts";

export interface HandlerDeps {
	sessions: SessionManager;
	outbox: EventOutbox;
	models: ModelCatalog;
	agents: AgentDetector;
	slashCommands: SlashCommandLister;
	mcpServers: McpServerLister;
	usage: UsageReader;
	shellEnv: ShellEnvProvider;
	utilityPrompt: UtilityPromptRunner;
	/** Applies setLogLevel to the root logger. */
	setLogLevel(level: "error" | "warn" | "info" | "debug"): void;
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
				if (params.workspacePath === undefined) return notImplemented("SIDE-22");
				const listed = await deps.slashCommands.list(
					params.agent,
					params.acpAgent,
					params.workspacePath,
				);
				if (!listed.ok) return listed;
				return ok({ commands: listed.value, fromCache: false });
			},
			listMcpServers: async (params) => {
				const listed = await deps.mcpServers.list(
					params.agent,
					params.acpAgent,
					params.workspacePath,
				);
				if (!listed.ok) return listed;
				return ok({ servers: listed.value });
			},
			listModels: async (params) => {
				const listed = await deps.models.list(params.agent, params.acpAgent);
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
<<<<<<< HEAD
			getGoal: (params) => deps.sessions.getGoal(params),
			setGoal: (params) => deps.sessions.setGoal(params),
			changeGoal: (params) => deps.sessions.changeGoal(params),
			compact: async () => notImplemented("AGENT-14"),
=======
			getGoal: async () => notImplemented("AGENT-13"),
			setGoal: async () => notImplemented("AGENT-13"),
			changeGoal: async () => notImplemented("AGENT-13"),
			compact: (params) => deps.sessions.compact(params),
>>>>>>> fc40aa3a330e54642eeaa156a03a2270bc504f44
			listAcpConfigOptions: (params) => deps.sessions.listAcpConfigOptions(params),
			setAcpConfigOption: (params) => deps.sessions.setAcpConfigOption(params),
		},
		notifications: {
			eventPersisted: async (params) => {
				const acknowledged = await deps.outbox.acknowledge(params.sessionId, params.eventId);
				if (!acknowledged.ok) throw acknowledged.error;
			},
			setLogLevel: (params) => deps.setLogLevel(params.level),
		},
	};
}
