/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the one file that fixes the shape of every hook screens call. The signatures are fixed by
 * core/api.ts; each hook body belongs to the feature named in its placeholder, and that feature
 * writes its test. `useActions` is real: it returns the action table of the container.
 * Behaviour: services-map.md 1.3 (services over zustand stores), 2.5 (query cache: SQL data
 * flows through service stores, not through TanStack Query; queries are for git, GitHub and
 * file data).
 * Must handle: a hook for an id that no longer exists returns an error state, never throws;
 * a store subscription re-renders only when the selected slice changes; a hook never starts
 * polling by itself without releasing it on unmount; hooks read the container from
 * `ServicesProvider` (core/context.tsx).
 * Our design choice: service stores hold SQL-backed data (repos, workspaces, chats, comments);
 * TanStack Query holds data that comes from git, `gh` and the file system, with a poll interval.
 * Reads per hook, for whoever fills in the bodies:
 *   useRepos, useRepoConfig            -> services.repo.store
 *   useWorkspaces, useWorkspace        -> services.workspace.store
 *   useWorkspaceStatus                 -> deriveWorkspaceStatus over workspace, sessions, git, github stores
 *   useSections                        -> services.sections.store
 *   useSessions, useChat               -> services.sessions.store and followUpQueue.store (chatView)
 *   useDraft                           -> services.composer.store
 *   useGitState                        -> services.git (watch) and services.github.store
 *   useChangedFiles, useFileDiff       -> query over services.git.changedFiles and services.fileDiff
 *   useFileTree                        -> query over services.workspaceFiles.tree
 *   useDiffComments                    -> services.review.store
 *   useTerminals, useRunState          -> services.terminals.store, runScripts.store, spotlight.store
 *   useSetting                         -> services.settings.store
 *   useAgentInstalls, useModels, useSlashCommands -> services.agentCatalog.store
 *   useCommands                        -> toCommandEntries over the command runner's enabled flags
 *   useUpdateStatus                    -> services.updates.store
 *   useBranchCommits, useBranches      -> query over services.git (log of the branch, branch list)
 *   useCheckLog                        -> query over services.github (log of one check run)
 *   usePullRequestActivity, useStack   -> query over services.github (reviews, comments, stack)
 *   useFileContent, useFileSearch, useContentSearch -> query over services.workspaceFiles
 *   useTerminalConnection              -> services.terminals (the live PTY and its saved history)
 *   useSetupState                      -> services.runScripts.store
 *   useEnvVars                         -> services.settings.store
 *   useGitHubAccess                    -> services.github.store (access)
 *   useInstalledApps                   -> query over Platform.opener.installedApps, through a service
 *   useMcpServers                      -> services.mcp.store
 *   useDiagnostics                     -> query over the captured environment and agent installs
 *   useClosedSessions                  -> services.sessions.store (sessions with closedAt set)
 *   useBacklogWorkspaces               -> services.workspace.store (backlog rows)
 *   useIssues, usePullRequestList      -> query over services.github (GitHub) and services.linear (Linear)
 *   useRepoFileSearch                  -> query over services.workspaceFiles, rooted at the main clone
 *   useArtifacts                       -> services.workspaceFiles (pages of the .context folder)
 *   usePlans                           -> services.sessions.store (plan approvals in stored events)
 *   useSnippets                        -> services.composer.store (snippets)
 *   useAgentPrograms                   -> services.system.store (program statuses and user paths)
 *   useProviderKeys, useAgentProviders, useAcpConfigOptions -> services.agentCatalog
 *   useAgentConfigFile, useConfigSyncPreview -> query over services.agentCatalog (agent config files)
 *   useGitHubOwners, useGitHubRepos, useRepoNameCheck -> query over services.github (gh api)
 *   useLinearAccess                    -> services.linear.store (access)
 *   useRepoTerminals                   -> services.terminals.store (repository terminals)
 *   useSystemInfo, useFullDiskAccess   -> query over Platform.system, through services.system
 * Test first: useActions returns the action table of the container it is given. The test for a
 * hook body lives with the feature that implements it (for example NAV-03 for useWorkspaces).
 */
import { idleLiveState } from "@conducted/protocol";
import { notImplemented, type WorkspaceId } from "@conducted/shared";
import { useMemo } from "react";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { Actions, Loadable, Queries } from "./api.ts";
import { useServices } from "./context.tsx";
import type { GitState, Repo } from "./model.ts";
import type { WorkspaceGitEntry } from "./services/git.ts";
import { toGitHubAccessView, type WorkspacePrEntry } from "./services/github.ts";
import type { SessionsState } from "./services/sessions.ts";
import { type ChatStatusInput, deriveWorkspaceStatus } from "./status/workspace-status.ts";

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

export const useRepos: Queries["useRepos"] = () => {
	const repo = useServices().services.repo;
	return useStore(repo.store, (state): Loadable<Repo[]> => {
		if (!state.loaded) return { state: "loading" };
		if (state.error !== undefined && state.error !== null) {
			return { state: "error", error: state.error };
		}
		const data = state.order
			.map((id) => state.reposById[id])
			.filter((row): row is Repo => row !== undefined);
		return { state: "ready", data };
	});
};
export const useRepoConfig: Queries["useRepoConfig"] = () => notImplemented("PRJ-04");
export const useWorkspaces: Queries["useWorkspaces"] = () => notImplemented("NAV-03");
export const useWorkspace: Queries["useWorkspace"] = () => notImplemented("WS-01");

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

export const useSections: Queries["useSections"] = () => notImplemented("NAV-04");
export const useSessions: Queries["useSessions"] = () => notImplemented("CHAT-01");
export const useChat: Queries["useChat"] = () => notImplemented("CHAT-07");
export const useDraft: Queries["useDraft"] = () => notImplemented("COMP-01");
export const useGitState: Queries["useGitState"] = () => notImplemented("GIT-04");
export const useChangedFiles: Queries["useChangedFiles"] = () => notImplemented("REV-01");
export const useFileDiff: Queries["useFileDiff"] = () => notImplemented("REV-02");
export const useFileTree: Queries["useFileTree"] = () => notImplemented("REV-06");
export const useDiffComments: Queries["useDiffComments"] = () => notImplemented("REV-03");
export const useTerminals: Queries["useTerminals"] = () => notImplemented("RUN-06");
export const useRunState: Queries["useRunState"] = () => notImplemented("RUN-01");
export const useSetting: Queries["useSetting"] = <T>(key: string): T => {
	const { services } = useServices();
	const stored = useStore(services.settings.store, (s) => s.values[key]);
	return (stored === undefined || stored === null ? services.settings.get<T>(key) : stored) as T;
};
export const useAgentInstalls: Queries["useAgentInstalls"] = () => notImplemented("SET-03");
export const useModels: Queries["useModels"] = () => notImplemented("COMP-02");
export const useSlashCommands: Queries["useSlashCommands"] = () => notImplemented("COMP-06");
export const useCommands: Queries["useCommands"] = () => notImplemented("NAV-07");
export const useUpdateStatus: Queries["useUpdateStatus"] = () => notImplemented("APP-06");
export const useBranchCommits: Queries["useBranchCommits"] = () => notImplemented("REV-01");
export const useBranches: Queries["useBranches"] = () => notImplemented("WS-02");
export const useCheckLog: Queries["useCheckLog"] = () => notImplemented("PR-04");
export const usePullRequestActivity: Queries["usePullRequestActivity"] = () =>
	notImplemented("PR-07");
export const useStack: Queries["useStack"] = () => notImplemented("PR-08");
export const useFileContent: Queries["useFileContent"] = () => notImplemented("REV-08");
export const useTerminalConnection: Queries["useTerminalConnection"] = () =>
	notImplemented("RUN-06");
export const useSetupState: Queries["useSetupState"] = () => notImplemented("WS-03");
export const useEnvVars: Queries["useEnvVars"] = () => notImplemented("SET-04");
export const useGitHubAccess: Queries["useGitHubAccess"] = () => {
	const { github } = useServices().services;
	const access = useStore(github.store, (s) => s.access);
	return useMemo(
		() =>
			access.status === "unknown" && access.reason === undefined
				? { state: "loading" as const }
				: { state: "ready" as const, data: toGitHubAccessView(access) },
		[access],
	);
};
export const useInstalledApps: Queries["useInstalledApps"] = () => notImplemented("WS-08");
export const useMcpServers: Queries["useMcpServers"] = () => notImplemented("SET-05");
export const useDiagnostics: Queries["useDiagnostics"] = () => notImplemented("APP-03");
export const useFileSearch: Queries["useFileSearch"] = () => notImplemented("REV-07");
export const useContentSearch: Queries["useContentSearch"] = () => notImplemented("REV-07");
export const useClosedSessions: Queries["useClosedSessions"] = () => notImplemented("CHAT-01");
export const useBacklogWorkspaces: Queries["useBacklogWorkspaces"] = () => notImplemented("WS-11");
export const useIssues: Queries["useIssues"] = () => notImplemented("PR-11");
export const usePullRequestList: Queries["usePullRequestList"] = () => notImplemented("PR-11");
export const useRepoFileSearch: Queries["useRepoFileSearch"] = () => notImplemented("COMP-04");
export const useArtifacts: Queries["useArtifacts"] = () => notImplemented("REV-10");
export const usePlans: Queries["usePlans"] = () => notImplemented("CHAT-26");
export const useSnippets: Queries["useSnippets"] = () => notImplemented("COMP-09");
export const useAgentPrograms: Queries["useAgentPrograms"] = () => notImplemented("PLAT-28");
export const useProviderKeys: Queries["useProviderKeys"] = () => notImplemented("SET-09");
export const useAgentProviders: Queries["useAgentProviders"] = () => notImplemented("SET-10");
export const useAcpConfigOptions: Queries["useAcpConfigOptions"] = () => notImplemented("AGENT-17");
export const useAgentConfigFile: Queries["useAgentConfigFile"] = () => notImplemented("SET-12");
export const useConfigSyncPreview: Queries["useConfigSyncPreview"] = () => notImplemented("SET-08");
export const useGitHubOwners: Queries["useGitHubOwners"] = () => notImplemented("PRJ-02");
export const useGitHubRepos: Queries["useGitHubRepos"] = () => notImplemented("PRJ-02");
export const useRepoNameCheck: Queries["useRepoNameCheck"] = () => notImplemented("PRJ-03");
export const useLinearAccess: Queries["useLinearAccess"] = () => notImplemented("PR-09");
export const useRepoTerminals: Queries["useRepoTerminals"] = () => notImplemented("RUN-06");
export const useSystemInfo: Queries["useSystemInfo"] = () => notImplemented("PLAT-32");
export const useFullDiskAccess: Queries["useFullDiskAccess"] = () => notImplemented("PLAT-24");

/** All mutations, grouped by area. Each returns a Result and never throws for expected failures. */
export const useActions = (): Actions => useServices().actions;
