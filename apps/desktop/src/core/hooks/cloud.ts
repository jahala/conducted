/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * @feature CLOUD-17 Cloud settings page
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the query hooks for the cloud connection: the pairing the Cloud page reads, the deploy's
 * state, the organisation switcher's entries and active entry and the paired Worker's readiness
 * (CLOUD-19), a cloud workspace's forwarding view, the status, resources and agent cost its header
 * shows, and the Mac's personal cloud settings (Git and Cloud pages).
 * Behaviour: core/hooks.ts states the contract; the pairing, forwarding, workspace and settings
 * services' stores hold the answers.
 * Must handle: a state not read yet (loading), and a Keychain or Worker read that failed (an error
 * state with its message).
 * Test first: CloudPage.test.tsx pairs with a Worker URL and a token, then unpairs.
 */
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { Loadable, OrganizationsView, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import { activeOrganization, organizationsFor } from "../organization.ts";
import { EMPTY_CLOUD_WORKSPACE_VIEW } from "../services/cloud-workspace.ts";
import { useSetting } from "./settings.ts";

export const useFileSyncStatus: Queries["useFileSyncStatus"] = (workspaceId) => {
	const container = useServices();
	const service = container.services.cloudFileSync;
	const host = useStore(
		container.services.workspace.store,
		(state) => state.workspacesById[workspaceId]?.host,
	);
	// Subscribe to the status and the workspace's saved switch, so a sync that finishes or the
	// switch turning off redraws the panel.
	useStore(service.store, (state) => state.byWorkspace[workspaceId]);
	useStore(
		container.services.workspace.store,
		(state) => state.workspacesById[workspaceId]?.remoteFileSyncEnabled,
	);
	useEffect(() => {
		if (host?.kind !== "cloud") return;
		void service.start(workspaceId);
	}, [service, workspaceId, host?.kind]);
	return service.viewOf(workspaceId, host ?? { kind: "local" });
};

export const useCloudDeploy: Queries["useCloudDeploy"] = () => {
	const service = useServices().services.cloudDeploy;
	return useStore(service.store, (current) => current);
};

export const useCloudPairing: Queries["useCloudPairing"] = () => {
	const service = useServices().services.cloudPairing;
	const state = useStore(service.store, (current) => current);
	if (state.state === "unknown") return { state: "loading" };
	if (state.state === "error") return { state: "error", error: state.error };
	return { state: "ready", data: state.pairing };
};

export const useOrganizations: Queries["useOrganizations"] = () => {
	const pairing = useCloudPairing();
	const choice = useSetting<string>("active_organization");
	return useMemo<Loadable<OrganizationsView>>(() => {
		// Only a stored cloud choice waits for the pairing: this Mac is known without it.
		if (pairing.state === "loading" && choice === "cloud") return { state: "loading" };
		// A Keychain read that failed, or one not done yet, lists this Mac only, so the app keeps
		// working locally.
		const organizations = organizationsFor(
			pairing.state === "ready" ? pairing.data : { paired: false, url: null },
		);
		return {
			state: "ready",
			data: { organizations, active: activeOrganization(choice, organizations) },
		};
	}, [pairing, choice]);
};

export const useCloudReadiness: Queries["useCloudReadiness"] = (url) => {
	const service = useServices().services.cloudPairing;
	const state = useStore(service.readinessStore, (current) => current);
	useEffect(() => {
		if (url !== null) void service.refreshReadiness(url);
	}, [service, url]);
	if (url === null || state.url !== url) return { state: "loading" };
	return state.readiness;
};

export const useCloudSettings: Queries["useCloudSettings"] = () => {
	const service = useServices().services.cloudSettings;
	const state = useStore(service.store, (current) => current);
	if (state.state === "unknown" || state.state === "loading") return { state: "loading" };
	if (state.state === "error") return { state: "error", error: state.error };
	return { state: "ready", data: { settings: state.settings, paired: state.paired } };
};

export const useCloudMcpOAuth: Queries["useCloudMcpOAuth"] = () => {
	const services = useServices().services;
	const service = services.cloudMcpOAuth;
	const state = useStore(service.store, (current) => current);
	const paired = useStore(services.cloudPairing.store, (current) =>
		current.state === "ready" ? current.pairing.paired : false,
	);
	// A pair or an unpair changes whose servers these are, so the list is read again.
	useEffect(() => {
		if (paired) void service.load();
	}, [service, paired]);
	if (state.state === "unknown") return { state: "loading" };
	if (state.state === "error") {
		return {
			state: "error",
			error: { code: "cloud_mcp_oauth_unreachable", message: state.message },
		};
	}
	return { state: "ready", data: state.view };
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
