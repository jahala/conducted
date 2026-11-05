/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the agent-catalog hooks: installs, models, slash commands, providers and config files.
 * Behaviour: services-map.md 2.5; core/hooks.ts states the contract.
 * Must handle: a model list that has not loaded, a catalog entry that is missing.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import { useEffect } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import { agentKey } from "../services/agent-catalog.ts";

export const useAgentInstalls: Queries["useAgentInstalls"] = () => {
	const store = useServices().services.agentCatalog.store;
	return useStore(store, (state) => state.installs);
};
export const useModels: Queries["useModels"] = (agent, acpAgent) => {
	const service = useServices().services.agentCatalog;
	const key = agentKey(agent, acpAgent);
	const models = useStore(service.store, (state) => state.models[key]);
	useEffect(() => {
		if (models === undefined) void service.loadModels(agent, acpAgent);
	}, [service, agent, acpAgent, models]);
	return models ?? { state: "loading" };
};
export const useSlashCommands: Queries["useSlashCommands"] = (sessionId) => {
	const { services } = useServices();
	const service = services.agentCatalog;
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	const commands = useStore(service.store, (state) => state.slashCommands[sessionId]);
	const agent = session?.config.agent;
	const acpAgent = session?.config.acpAgent;
	useEffect(() => {
		if (agent === undefined) return;
		void service.loadSlashCommands(sessionId, agent, acpAgent);
	}, [service, sessionId, agent, acpAgent]);
	return commands ?? { state: "loading" };
};
export const useProviderKeys: Queries["useProviderKeys"] = () => notImplemented("SET-09");
export const useAgentProviders: Queries["useAgentProviders"] = () => notImplemented("SET-10");
export const useAcpConfigOptions: Queries["useAcpConfigOptions"] = () => notImplemented("AGENT-17");
export const useAgentConfigFile: Queries["useAgentConfigFile"] = () => notImplemented("SET-12");
export const useConfigSyncPreview: Queries["useConfigSyncPreview"] = () => notImplemented("SET-08");
