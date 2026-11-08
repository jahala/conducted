/**
 * @feature DATA-01 Query hook contract for screens; SET-05 MCP servers: list, status and logs
 * Owns: the settings hooks: one stored setting, environment variables, and the MCP servers of the
 * chat the Agents page shows.
 * Behaviour: services-map.md 1.3 (settings store), 5B.6 (per-session MCP availability); core/hooks.ts
 * states the contract.
 * Must handle: a key with no stored value, returning the default instead; no chat open (the MCP
 * list says so through its own screen); a chat or workspace that is gone (an error state); only
 * the newest list for a chat is stored.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { appError, type SessionId } from "@conducted/shared";
import { useEffect } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import { mcpKey } from "../services/mcp.ts";
import { envScopeKey } from "../services/settings.ts";

export const useSetting: Queries["useSetting"] = <T>(key: string): T => {
	const { services } = useServices();
	const stored = useStore(services.settings.store, (s) => s.values[key]);
	return (stored === undefined || stored === null ? services.settings.get<T>(key) : stored) as T;
};
export const useEnvVars: Queries["useEnvVars"] = (scope) => {
	const service = useServices().services.settings;
	const key = envScopeKey(scope);
	const value = useStore(service.store, (state) => state.envVars?.[key]);
	const repoId = scope === "global" ? null : scope.repoId;
	useEffect(() => {
		void service.loadEnvVars(repoId === null ? "global" : { repoId });
	}, [service, repoId]);
	return value ?? { state: "loading" };
};

/**
 * The chat last on screen. Settings is a page of its own, so no chat is on screen while it is
 * open; the Agents page reads this chat's MCP servers.
 */
export const useLastViewedSessionId = (): SessionId | null => {
	const store = useServices().services.sessions.store;
	return useStore(store, (state) => state.lastViewedSessionId);
};

export const useMcpServers: Queries["useMcpServers"] = (sessionId) => {
	const { services } = useServices();
	const service = services.mcp;
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	const sessionsLoaded = useStore(services.sessions.store, (state) => state.loaded);
	const workspace = useStore(services.workspace.store, (state) =>
		session === undefined ? undefined : state.workspacesById[session.workspaceId],
	);
	const workspacesLoaded = useStore(services.workspace.store, (state) => state.loaded);
	const key =
		session === undefined || workspace === undefined
			? undefined
			: mcpKey(workspace.path, session.config.agent, session.config.acpAgent);
	const value = useStore(service.store, (state) =>
		key === undefined ? undefined : state.servers[key],
	);
	const agent = session?.config.agent;
	const acpAgent = session?.config.acpAgent;
	const workspacePath = workspace?.path;

	useEffect(() => {
		if (agent === undefined || workspacePath === undefined) return;
		if (value !== undefined) return;
		void service.refresh({ agent, acpAgent, workspacePath, sessionId });
	}, [service, sessionId, agent, acpAgent, workspacePath, value]);

	if (session === undefined) {
		return sessionsLoaded
			? {
					state: "error",
					error: appError("session_unknown", "That chat no longer exists."),
				}
			: { state: "loading" };
	}
	if (workspace === undefined) {
		return workspacesLoaded
			? {
					state: "error",
					error: appError("workspace_unknown", "That workspace no longer exists."),
				}
			: { state: "loading" };
	}
	return value ?? { state: "loading" };
};
