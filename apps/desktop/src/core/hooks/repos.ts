/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the repository hooks. Their bodies type-check against core/api.ts.
 * Behaviour: services-map.md 1.3 (services over zustand stores); core/hooks.ts states the contract.
 * Must handle: a store that has not loaded, a reload that fails.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { Repo } from "../model.ts";

export const useRepos: Queries["useRepos"] = () => {
	const store = useServices().services.repo.store;
	const loaded = useStore(store, (state) => state.loaded);
	const error = useStore(store, (state) => state.error);
	const reposById = useStore(store, (state) => state.reposById);
	const order = useStore(store, (state) => state.order);
	return useMemo<Loadable<Repo[]>>(() => {
		if (!loaded) return { state: "loading" };
		if (error !== undefined && error !== null) return { state: "error", error };
		const data = order.map((id) => reposById[id]).filter((row): row is Repo => row !== undefined);
		return { state: "ready", data };
	}, [loaded, error, reposById, order]);
};

export const useRepoConfig: Queries["useRepoConfig"] = (repoId) => {
	const service = useServices().services.repo;
	const config = useStore(service.store, (state) => state.configs[repoId]);
	const error = useStore(service.store, (state) => state.configErrors?.[repoId]);
	useEffect(() => {
		if (config === undefined) void service.loadConfig(repoId);
	}, [service, repoId, config]);
	if (error !== undefined) return { state: "error", error };
	if (config === undefined) return { state: "loading" };
	return { state: "ready", data: config };
};
