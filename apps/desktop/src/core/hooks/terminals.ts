/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the terminal hooks: workspace and repository terminals, live connections, run state.
 * Behaviour: services-map.md 1.3 (terminals store); core/hooks.ts states the contract.
 * Must handle: terminals that have not loaded, a connection still opening.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { appError } from "@conducted/shared";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { Loadable, Queries, RunState } from "../api.ts";
import { useServices } from "../context.tsx";

export const useTerminals: Queries["useTerminals"] = (workspaceId) => {
	const service = useServices().services.terminals;
	const terminals = useStore(service.store, (state) => state.byWorkspace[workspaceId]);
	const error = useStore(service.store, (state) => state.errors[`w:${workspaceId}`]);
	useEffect(() => {
		if (terminals === undefined) void service.loadWorkspace(workspaceId);
	}, [service, workspaceId, terminals]);
	if (error !== undefined) return { state: "error", error };
	if (terminals === undefined) return { state: "loading" };
	return { state: "ready", data: [...terminals] };
};
export const useRunState: Queries["useRunState"] = (workspaceId) => {
	const container = useServices();
	const workspaceStore = container.services.workspace.store;
	const repoStore = container.services.repo.store;
	const runStore = container.services.runScripts.store;
	const loaded = useStore(workspaceStore, (state) => state.loaded);
	const workspace = useStore(workspaceStore, (state) => state.workspacesById[workspaceId]);
	const run = useStore(runStore, (state) => state.byWorkspace[workspaceId]);
	const config = useStore(repoStore, (state) =>
		workspace === undefined ? undefined : state.configs[workspace.repoId],
	);
	const configError = useStore(repoStore, (state) =>
		workspace === undefined ? undefined : state.configErrors?.[workspace.repoId],
	);

	useEffect(() => {
		if (workspace !== undefined && config === undefined && configError === undefined) {
			void container.services.repo.loadConfig(workspace.repoId);
		}
	}, [container, workspace, config, configError]);

	return useMemo<Loadable<RunState>>(() => {
		if (!loaded) return { state: "loading" };
		if (workspace === undefined) {
			return {
				state: "error",
				error: appError("workspace_unknown", "That workspace no longer exists."),
			};
		}
		if (config === undefined) {
			if (configError !== undefined) return { state: "error", error: configError };
			return { state: "loading" };
		}
		const current = run ?? {
			actions: config.runScripts,
			running: [],
			spotlight: { active: false, terminalId: null },
			detectedPorts: [],
		};
		return { state: "ready", data: { ...current, actions: config.runScripts } };
	}, [loaded, workspace, config, configError, run]);
};
export const useTerminalConnection: Queries["useTerminalConnection"] = (id) => {
	const service = useServices().services.terminals;
	const connection = useStore(service.store, (state) => state.connections[id]);
	useEffect(() => {
		if (connection === undefined) void service.ensureConnection(id);
	}, [service, id, connection]);
	return connection ?? { state: "loading" };
};
export const useRepoTerminals: Queries["useRepoTerminals"] = (repoId) => {
	const service = useServices().services.terminals;
	const terminals = useStore(service.store, (state) => state.byRepo[repoId]);
	const error = useStore(service.store, (state) => state.errors[`r:${repoId}`]);
	useEffect(() => {
		if (terminals === undefined) void service.loadRepo(repoId);
	}, [service, repoId, terminals]);
	if (error !== undefined) return { state: "error", error };
	if (terminals === undefined) return { state: "loading" };
	return { state: "ready", data: [...terminals] };
};
