/**
 * @feature DATA-01 Query hook contract for screens; SET-10 OpenCode providers and their keys
 * Owns: the agent-catalog hooks: installs, models, slash commands, providers and config files,
 * and the ACP chat options hook (AGENT-17).
 * Behaviour: services-map.md 2.5; core/hooks.ts states the contract.
 * Must handle: a model list that has not loaded, a catalog entry that is missing.
 * Test first: the test for a hook body lives with the feature that implements it. SET-10's
 * provider hook loads the catalogue through the agent catalogue service.
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
export const useProviderKeys: Queries["useProviderKeys"] = (agent, acpAgent) => {
	const service = useServices().services.agentCatalog;
	const key = agentKey(agent, acpAgent);
	const value = useStore(service.store, (state) => state.providerKeys?.[key]);
	useEffect(() => {
		if (value === undefined) void service.loadProviderKeys(agent, acpAgent);
	}, [service, agent, acpAgent, value]);
	return value ?? { state: "loading" };
};
export const useAgentProviders: Queries["useAgentProviders"] = (agent, acpAgent) => {
	const service = useServices().services.agentCatalog;
	const key = agentKey(agent, acpAgent);
	const value = useStore(service.store, (state) => state.providers?.[key]);
	useEffect(() => {
		if (value === undefined) void service.loadProviders(agent, acpAgent);
	}, [service, agent, acpAgent, value]);
	return value ?? { state: "loading" };
};
export const useAcpConfigOptions: Queries["useAcpConfigOptions"] = (sessionId) => {
	const service = useServices().services.sessions;
	const options = useStore(service.store, (state) => state.acpConfigOptions?.[sessionId]);
	useEffect(() => {
		if (options === undefined) void service.loadAcpConfigOptions(sessionId);
	}, [service, sessionId, options]);
	return options ?? { state: "loading" };
};
export const useAgentConfigFile: Queries["useAgentConfigFile"] = () => notImplemented("SET-12");
export const useConfigSyncPreview: Queries["useConfigSyncPreview"] = () => notImplemented("SET-08");
