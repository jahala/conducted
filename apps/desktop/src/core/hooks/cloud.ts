/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * @feature CLOUD-17 Cloud settings page
 * Owns: the query hooks for the cloud connection: the pairing the Connections page reads, a
 * cloud workspace's forwarding view, and the Mac's personal cloud settings (Git and Cloud pages).
 * Behaviour: core/hooks.ts states the contract; the pairing, forwarding and settings services'
 * stores hold the answers.
 * Must handle: a state not read yet (loading), and a Keychain or Worker read that failed (an error
 * state with its message).
 * Test first: ConnectionsPage.test.tsx pairs with a Worker URL and a token, then unpairs.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";

export const useFileSyncStatus: Queries["useFileSyncStatus"] = (workspaceId) => {
	const container = useServices();
	const service = container.services.cloudFileSync;
	const host = useStore(
		container.services.workspace.store,
		(state) => state.workspacesById[workspaceId]?.host,
	);
	// Subscribe to the status so a sync that finishes redraws the panel.
	useStore(service.store, (state) => state.byWorkspace[workspaceId]);
	useEffect(() => {
		if (host?.kind !== "cloud") return;
		void service.start(workspaceId);
	}, [service, workspaceId, host?.kind]);
	return service.viewOf(workspaceId, host ?? { kind: "local" });
};

export const useCloudPairing: Queries["useCloudPairing"] = () => {
	const service = useServices().services.cloudPairing;
	const state = useStore(service.store, (current) => current);
	if (state.state === "unknown") return { state: "loading" };
	if (state.state === "error") return { state: "error", error: state.error };
	return { state: "ready", data: state.pairing };
};

export const useCloudSettings: Queries["useCloudSettings"] = () => {
	const service = useServices().services.cloudSettings;
	const state = useStore(service.store, (current) => current);
	if (state.state === "unknown" || state.state === "loading") return { state: "loading" };
	if (state.state === "error") return { state: "error", error: state.error };
	return { state: "ready", data: { settings: state.settings, paired: state.paired } };
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
