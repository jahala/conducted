/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Owns: the query hooks for the cloud connection: the pairing the Connections page reads, a cloud
 * workspace's forwarding view, and the status, resources and agent cost its header shows.
 * Behaviour: core/hooks.ts states the contract; the pairing service's store holds the answer.
 * Must handle: a state not read yet (loading), and a Keychain read that failed (an error state
 * with its message).
 * Test first: ConnectionsPage.test.tsx pairs with a Worker URL and a token, then unpairs.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import { EMPTY_CLOUD_WORKSPACE_VIEW } from "../services/cloud-workspace.ts";

export const useCloudPairing: Queries["useCloudPairing"] = () => {
	const service = useServices().services.cloudPairing;
	const state = useStore(service.store, (current) => current);
	if (state.state === "unknown") return { state: "loading" };
	if (state.state === "error") return { state: "error", error: state.error };
	return { state: "ready", data: state.pairing };
};

/**
 * CLOUD-10: the forwarding switches, forwards and discovered ports of one cloud workspace.
 * Subscribes only to that workspace's slice, so an update on another workspace does not redraw.
 */
export const usePortForwards: Queries["usePortForwards"] = (workspaceId) => {
	const service = useServices().services.portForwards;
	return (
		useStore(service.store, (state) => state.byWorkspace[workspaceId]) ?? {
			forwardingEnabled: false,
			autoForwardEnabled: false,
			waiting: false,
			forwards: [],
			detectedPorts: [],
			error: null,
		}
	);
};

/**
 * CLOUD-15: a cloud workspace's status, resource meters and agent cost. The header holds this
 * view while it is mounted, so the poll starts and stops with the screen.
 */
export const useCloudWorkspace: Queries["useCloudWorkspace"] = (workspaceId) => {
	const service = useServices().services.cloudWorkspace;
	const view = useStore(service.store, (state) => state.byWorkspace[workspaceId]);
	useEffect(() => service.watch(workspaceId), [service, workspaceId]);
	return view ?? EMPTY_CLOUD_WORKSPACE_VIEW;
};
