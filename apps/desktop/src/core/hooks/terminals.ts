/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the terminal hooks: workspace and repository terminals, live connections, run state.
 * Behaviour: services-map.md 1.3 (terminals store); core/hooks.ts states the contract.
 * Must handle: terminals that have not loaded, a connection still opening.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import { useEffect } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
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
export const useRunState: Queries["useRunState"] = () => notImplemented("RUN-01");
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
