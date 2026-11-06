/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the system hooks: app updates, diagnostics, agent programs and machine facts.
 * Behaviour: services-map.md 2.5; core/hooks.ts states the contract.
 * Must handle: a system service that has not answered yet.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { type AppError, appError, notImplemented } from "@conducted/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { DiagnosticsCapture, SystemInfo } from "../model.ts";

export const useUpdateStatus: Queries["useUpdateStatus"] = () => notImplemented("APP-06");

const DIAGNOSTICS_KEY = ["system", "diagnostics"] as const;

/**
 * Captures the app and the user's environment for the diagnostics page. Every mount captures
 * again, because the environment and the logs belong to the moment the user asks for help.
 */
export const useDiagnostics: Queries["useDiagnostics"] = () => {
	const { services } = useServices();
	const query = useQuery<DiagnosticsCapture, AppError>({
		queryKey: DIAGNOSTICS_KEY,
		queryFn: async () => {
			const captured = await services.system.captureDiagnostics();
			if (!captured.ok) throw captured.error;
			return captured.value;
		},
		staleTime: 0,
	});
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};

/** PLAT-28: the program store the system service fills at startup and on every status event. */
export const useAgentPrograms: Queries["useAgentPrograms"] = () =>
	useStore(useServices().services.system.store, (state) => state.programs);

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

/** PLAT-24: whether macOS lets the app read protected folders, read when the page opens. */
export const useFullDiskAccess: Queries["useFullDiskAccess"] = () => {
	const { platform } = useServices();
	const [access, setAccess] = useState<Loadable<boolean>>({ state: "loading" });

	useEffect(() => {
		let active = true;
		void platform.system.hasFullDiskAccess().then(
			(granted) => {
				if (active) setAccess({ state: "ready", data: granted });
			},
			(cause: unknown) => {
				if (!active) return;
				setAccess({
					state: "error",
					error: appError(
						"full_disk_access_check_failed",
						"Full Disk Access could not be checked.",
						cause,
					),
				});
			},
		);
		return () => {
			active = false;
		};
	}, [platform]);

	return access;
};
