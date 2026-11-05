/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the system hooks: app updates, diagnostics, agent programs and machine facts.
 * Behaviour: services-map.md 2.5; core/hooks.ts states the contract.
 * Must handle: a system service that has not answered yet.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import type { Queries } from "../api.ts";

export const useUpdateStatus: Queries["useUpdateStatus"] = () => notImplemented("APP-06");
export const useDiagnostics: Queries["useDiagnostics"] = () => notImplemented("APP-03");
export const useAgentPrograms: Queries["useAgentPrograms"] = () => notImplemented("PLAT-28");
export const useSystemInfo: Queries["useSystemInfo"] = () => notImplemented("PLAT-32");
export const useFullDiskAccess: Queries["useFullDiskAccess"] = () => notImplemented("PLAT-24");
