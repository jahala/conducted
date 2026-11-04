/**
 * @feature DATA-01 Query hooks and actions for screens
 * Owns: the hooks screens call. Each one reads a service store (core/services) and returns a
 * Loadable, so screens design their own loading and error states. The signatures are fixed by
 * core/api.ts. `useActions` is real: it returns the action table of the container.
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
 * Test first: useWorkspaces returns "ready" with the rows a test database holds.
 */
import { notImplemented } from "@conducted/shared";
import type { Actions, Queries } from "./api.ts";
import { useServices } from "./context.tsx";

export const useRepos: Queries["useRepos"] = () => notImplemented("PRJ-01");
export const useRepoConfig: Queries["useRepoConfig"] = () => notImplemented("PRJ-04");
export const useWorkspaces: Queries["useWorkspaces"] = () => notImplemented("NAV-03");
export const useWorkspace: Queries["useWorkspace"] = () => notImplemented("WS-01");
export const useWorkspaceStatus: Queries["useWorkspaceStatus"] = () => notImplemented("WS-09");
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
export const useSetting: Queries["useSetting"] = <T>(_key: string): T => notImplemented("SET-01");
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
export const useGitHubAccess: Queries["useGitHubAccess"] = () => notImplemented("PR-01");
export const useInstalledApps: Queries["useInstalledApps"] = () => notImplemented("WS-08");
export const useMcpServers: Queries["useMcpServers"] = () => notImplemented("SET-05");
export const useDiagnostics: Queries["useDiagnostics"] = () => notImplemented("APP-03");
export const useFileSearch: Queries["useFileSearch"] = () => notImplemented("REV-07");
export const useContentSearch: Queries["useContentSearch"] = () => notImplemented("REV-07");
export const useClosedSessions: Queries["useClosedSessions"] = () => notImplemented("CHAT-01");

/** All mutations, grouped by area. Each returns a Result and never throws for expected failures. */
export const useActions = (): Actions => useServices().actions;
