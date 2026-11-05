/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the system hooks: app updates, diagnostics, agent programs and machine facts.
 * Behaviour: services-map.md 2.5; core/hooks.ts states the contract.
 * Must handle: a system service that has not answered yet.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { type AppError, appError, notImplemented } from "@conducted/shared";
import { useQuery } from "@tanstack/react-query";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { SystemInfo } from "../model.ts";

export const useUpdateStatus: Queries["useUpdateStatus"] = () => notImplemented("APP-06");
export const useDiagnostics: Queries["useDiagnostics"] = () => notImplemented("APP-03");
export const useAgentPrograms: Queries["useAgentPrograms"] = () => notImplemented("PLAT-28");

const SYSTEM_INFO_KEY = ["system", "info"] as const;

/** PLAT-32: the macOS version and both CPU facts. They do not change, so the answer is not stale. */
export const useSystemInfo: Queries["useSystemInfo"] = () => {
	const { platform } = useServices();
	const query = useQuery<SystemInfo, AppError>({
		queryKey: SYSTEM_INFO_KEY,
		queryFn: async () => {
			try {
				return await platform.system.info();
			} catch (cause) {
				throw appError(
					"system_info_failed",
					"The Mac's system information could not be read.",
					cause,
				);
			}
		},
		staleTime: Number.POSITIVE_INFINITY,
	});
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};

export const useFullDiskAccess: Queries["useFullDiskAccess"] = () => notImplemented("PLAT-24");
