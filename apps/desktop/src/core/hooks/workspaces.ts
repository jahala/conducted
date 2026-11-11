/**
 * @feature DATA-01 Query hook contract for screens
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the workspace hooks and the open-in-app list. `useWorkspaces` lists the active
 * organisation's workspaces (CLOUD-19). The status rule reads git state through
 * GitService.stateOf, so there is one builder for the sidebar and the Git panel.
 * Behaviour: services-map.md 1.3, 2.5; core/hooks.ts states the contract.
 * Must handle: a workspace that no longer exists, a status that has not loaded yet, a workspace
 * table whose load failed (`loadError`, shown as an error rather than an empty list).
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { idleLiveState } from "@conducted/protocol";
import { type AppError, appError, type WorkspaceId } from "@conducted/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { BacklogWorkspace, SetupView, Workspace } from "../model.ts";
import { workspaceInOrganization } from "../organization.ts";
import type { SessionsState } from "../services/sessions.ts";
import { type ChatStatusInput, deriveWorkspaceStatus } from "../status/workspace-status.ts";
import { useActiveOrganization } from "./cloud.ts";

/** The chats of a workspace as the status rule sees them. */
function chatsFor(state: SessionsState, workspaceId: WorkspaceId): readonly ChatStatusInput[] {
	const ids = state.byWorkspace[workspaceId] ?? [];
	return ids.map((id) => ({
		liveState: state.liveStates[id] ?? idleLiveState,
		cancelling: state.cancelling[id] === true,
		closed: state.sessions[id]?.closedAt != null,
	}));
}

/**
 * True when two chat lists carry the same facts for the status rule. Streaming events change
 * other parts of the live state, so an equal list keeps the previous selection and no re-render.
 */
function sameChatStatus(
	left: readonly ChatStatusInput[],
	right: readonly ChatStatusInput[],
): boolean {
	if (left.length !== right.length) return false;
	return left.every((chat, index) => {
		const other = right[index];
		return (
			other !== undefined &&
			chat.cancelling === other.cancelling &&
			chat.closed === other.closed &&
			chat.liveState.status === other.liveState.status &&
			chat.liveState.openInteraction?.interaction.kind ===
				other.liveState.openInteraction?.interaction.kind &&
			chat.liveState.backgroundTasks.length === other.liveState.backgroundTasks.length
		);
	});
}

export const useWorkspaces: Queries["useWorkspaces"] = () => {
	const store = useServices().services.workspace.store;
	const loaded = useStore(store, (state) => state.loaded);
	const loadError = useStore(store, (state) => state.loadError);
	const workspacesById = useStore(store, (state) => state.workspacesById);
	// CLOUD-19: the lists show the active organisation's workspaces, as Conductor's do (main `Ttn`).
	const organization = useActiveOrganization();
	return useMemo<Loadable<Workspace[]>>(() => {
		if (!loaded) return { state: "loading" };
		// A failed load leaves no rows; an empty ready list would read as "no workspaces" (DATA-01).
		if (loadError !== null) return { state: "error", error: loadError };
		const data = Object.values(workspacesById)
			.filter((workspace) => workspaceInOrganization(workspace, organization))
			.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
		return { state: "ready", data };
	}, [loaded, loadError, workspacesById, organization]);
};
export const useWorkspace: Queries["useWorkspace"] = (id) => {
	const store = useServices().services.workspace.store;
	const loaded = useStore(store, (state) => state.loaded);
	const loadError = useStore(store, (state) => state.loadError);
	const workspace = useStore(store, (state) => state.workspacesById[id]);
	return useMemo<Loadable<Workspace>>(() => {
		if (!loaded) return { state: "loading" };
		if (loadError !== null) return { state: "error", error: loadError };
		if (workspace === undefined) {
			return {
				state: "error",
				error: appError("workspace_unknown", "That workspace no longer exists."),
			};
		}
		return { state: "ready", data: workspace };
	}, [loaded, loadError, workspace]);
};

export const useWorkspaceStatus: Queries["useWorkspaceStatus"] = (workspaceId) => {
	const container = useServices();
	const { workspace, sessions: sessionService, git, github } = container.services;
	const state = useStore(workspace.store, (s) => s.workspacesById[workspaceId]?.state);
	const settingUp = useStore(workspace.store, (s) => s.setup[workspaceId] === "running");
	const chats = useStoreWithEqualityFn(
		sessionService.store,
		(s) => chatsFor(s, workspaceId),
		sameChatStatus,
	);
	// Subscribe to the git entry so a new poll re-renders; stateOf reads the store itself.
	useStore(git.store, (s) => s.byWorkspace[workspaceId]);
	const prEntry = useStore(github.store, (s) => s.byWorkspace[workspaceId]);
	// The pending action lives in the GitHub store, so this re-renders when an action starts and ends.
	const pendingAction = useStore(github.store, () => github.pendingAction(workspaceId));

	if (state === undefined) return null;
	return deriveWorkspaceStatus({
		state,
		settingUp,
		chats,
		git: git.stateOf(workspaceId, prEntry, pendingAction),
	});
};

export const useInstalledApps: Queries["useInstalledApps"] = () => {
	const { platform } = useServices();
	const query = useQuery<string[], AppError>({
		queryKey: ["opener", "installed-apps"],
		queryFn: async () => {
			try {
				return await platform.opener.installedApps();
			} catch (cause) {
				throw appError("installed_apps_failed", "The apps on this Mac could not be listed.", cause);
			}
		},
		staleTime: 30_000,
	});
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};
/**
 * The Rust shell reads an app's icon once and keeps a copy, so the answer is kept for the life of
 * the window, as Conductor keeps its app icons (services-map.md 2.5, `staleTime: Infinity`).
 */
export const useAppIcon: Queries["useAppIcon"] = (appName) => {
	const { platform } = useServices();
	const query = useQuery<string | null, AppError>({
		queryKey: ["opener", "app-icon", appName],
		queryFn: async () => {
			const icon = await platform.opener.appIcon(appName);
			if (!icon.ok) throw icon.error;
			return icon.value;
		},
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};
export const useBacklogWorkspaces: Queries["useBacklogWorkspaces"] = () => {
	const store = useServices().services.workspace.store;
	const loaded = useStore(store, (state) => state.backlogLoaded);
	const byId = useStore(store, (state) => state.backlogById);
	return useMemo<Loadable<BacklogWorkspace[]>>(() => {
		if (!loaded) return { state: "loading" };
		return {
			state: "ready",
			data: Object.values(byId).sort(
				(left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
			),
		};
	}, [byId, loaded]);
};
export const useSetupState: Queries["useSetupState"] = (workspaceId) => {
	const container = useServices();
	const workspaceStore = container.services.workspace.store;
	const repoStore = container.services.repo.store;
	const loaded = useStore(workspaceStore, (state) => state.loaded);
	const workspace = useStore(workspaceStore, (state) => state.workspacesById[workspaceId]);
	const run = useStore(workspaceStore, (state) => state.setupRuns?.[workspaceId]);
	const config = useStore(repoStore, (state) =>
		workspace === undefined ? undefined : state.configs[workspace.repoId],
	);
	const configError = useStore(repoStore, (state) =>
		workspace === undefined ? undefined : state.configErrors?.[workspace.repoId],
	);

	useEffect(() => {
		if (workspace !== undefined && config === undefined && configError === undefined) {
			void container.services.repo.loadConfig(workspace.repoId);
		}
	}, [container, workspace, config, configError]);

	return useMemo<Loadable<SetupView>>(() => {
		if (!loaded) return { state: "loading" };
		if (workspace === undefined) {
			return {
				state: "error",
				error: appError("workspace_unknown", "That workspace no longer exists."),
			};
		}
		if (config === undefined) {
			if (configError !== undefined) return { state: "error", error: configError };
			return { state: "loading" };
		}
		return {
			state: "ready",
			data: {
				state: run?.state ?? "idle",
				hasScript: config.setupScript !== null && config.setupScript.trim() !== "",
				exitCode: run?.exitCode ?? null,
				filesCopied: workspace.filesCopied,
				terminalId: run?.terminalId ?? null,
				log: run?.log ?? "missing",
				interruptedReason: run?.interruptedReason ?? null,
			},
		};
	}, [loaded, workspace, run, config, configError]);
};
