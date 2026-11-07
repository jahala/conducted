/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-17 Cloud settings page
 * Owns: the query hooks the Connections, Git and Cloud pages read: whether this Mac is paired and
 * with which Worker, and the Mac's personal cloud settings.
 * Behaviour: core/hooks.ts states the contract; the pairing and settings services' stores hold the
 * answers.
 * Must handle: a state not read yet (loading), and a Keychain or Worker read that failed (an error
 * state with its message).
 * Test first: ConnectionsPage.test.tsx pairs with a Worker URL and a token, then unpairs.
 */
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";

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
