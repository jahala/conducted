/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the workspace hooks, the status rule's private helpers, and the open-in-app list.
 * Behaviour: services-map.md 1.3, 2.5; core/hooks.ts states the contract.
 * Must handle: a workspace that no longer exists, a status that has not loaded yet.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { idleLiveState } from "@conducted/protocol";
import { appError, notImplemented, type WorkspaceId } from "@conducted/shared";
import { useMemo } from "react";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { GitState, Workspace } from "../model.ts";
import type { WorkspaceGitEntry } from "../services/git.ts";
import type { WorkspacePrEntry } from "../services/github.ts";
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

/** The git input the status rule needs, built from the two polled entries. */
function gitStateOf(
	gitEntry: WorkspaceGitEntry | undefined,
	prEntry: WorkspacePrEntry | undefined,
): GitState | null {
	const snapshot = gitEntry?.snapshot ?? null;
	if (snapshot === null) return null;
	const changedFiles = snapshot.files.length;
	return {
		branch: snapshot.branch ?? "",
		uncommittedFiles: changedFiles,
		changedFiles,
		linesAdded: snapshot.files.reduce((total, file) => total + file.linesAdded, 0),
		linesRemoved: snapshot.files.reduce((total, file) => total + file.linesRemoved, 0),
		hasConflicts: snapshot.conflictedPaths.length > 0,
		operation: snapshot.operation,
		sync: snapshot.sync,
		pullRequest: prEntry?.pullRequest ?? null,
		pullRequestUnavailable:
			prEntry === undefined
				? "loading"
				: prEntry.unavailable === "no_pr"
					? "none"
					: prEntry.unavailable,
		untrackedFilesTruncated: snapshot.untrackedTruncated,
		pendingPullRequestAction: null,
	};
}

export const useWorkspaces: Queries["useWorkspaces"] = () => notImplemented("NAV-03");
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
	const gitEntry = useStore(git.store, (s) => s.byWorkspace[workspaceId]);
	const prEntry = useStore(github.store, (s) => s.byWorkspace[workspaceId]);

	return useMemo(() => {
		if (state === undefined) return null;
		return deriveWorkspaceStatus({
			state,
			settingUp,
			chats,
			git: gitStateOf(gitEntry, prEntry),
		});
	}, [state, settingUp, chats, gitEntry, prEntry]);
};

export const useInstalledApps: Queries["useInstalledApps"] = () => notImplemented("WS-08");
export const useBacklogWorkspaces: Queries["useBacklogWorkspaces"] = () => notImplemented("WS-11");
export const useSetupState: Queries["useSetupState"] = () => notImplemented("WS-03");
