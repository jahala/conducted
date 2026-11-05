/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the workspace hooks and the open-in-app list. The status rule reads git state through
 * GitService.stateOf, so there is one builder for the sidebar and the Git panel.
 * Behaviour: services-map.md 1.3, 2.5; core/hooks.ts states the contract.
 * Must handle: a workspace that no longer exists, a status that has not loaded yet.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { idleLiveState } from "@conducted/protocol";
import { appError, notImplemented, type WorkspaceId } from "@conducted/shared";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { SetupView, Workspace } from "../model.ts";
import type { SessionsState } from "../services/sessions.ts";
import { type ChatStatusInput, deriveWorkspaceStatus } from "../status/workspace-status.ts";

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
	const workspacesById = useStore(store, (state) => state.workspacesById);
	return useMemo<Loadable<Workspace[]>>(() => {
		if (!loaded) return { state: "loading" };
		const data = Object.values(workspacesById).sort(
			(left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
		);
		return { state: "ready", data };
	}, [loaded, workspacesById]);
};
export const useWorkspace: Queries["useWorkspace"] = (id) => {
	const store = useServices().services.workspace.store;
	const loaded = useStore(store, (state) => state.loaded);
	const workspace = useStore(store, (state) => state.workspacesById[id]);
	return useMemo<Loadable<Workspace>>(() => {
		if (!loaded) return { state: "loading" };
		if (workspace === undefined) {
			return {
				state: "error",
				error: appError("workspace_unknown", "That workspace no longer exists."),
			};
		}
		return { state: "ready", data: workspace };
	}, [loaded, workspace]);
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

	if (state === undefined) return null;
	return deriveWorkspaceStatus({
		state,
		settingUp,
		chats,
		git: git.stateOf(workspaceId, prEntry, github.pendingAction(workspaceId)),
	});
};

export const useInstalledApps: Queries["useInstalledApps"] = () => notImplemented("WS-08");
export const useBacklogWorkspaces: Queries["useBacklogWorkspaces"] = () => notImplemented("WS-11");
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
