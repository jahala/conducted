/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the settings hooks: one stored setting, environment variables, MCP servers.
 * Behaviour: services-map.md 1.3 (settings store); core/hooks.ts states the contract.
 * Must handle: a key with no stored value, returning the default instead.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import { useEffect } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
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
export const useMcpServers: Queries["useMcpServers"] = () => notImplemented("SET-05");
