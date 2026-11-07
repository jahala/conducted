/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * Owns: the query hook the Connections page reads to show whether this Mac is paired and with
 * which Worker.
 * Behaviour: core/hooks.ts states the contract; the pairing service's store holds the answer.
 * Must handle: a state not read yet (loading), and a Keychain read that failed (an error state
 * with its message).
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
