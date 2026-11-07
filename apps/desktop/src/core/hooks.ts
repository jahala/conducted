/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the one module that fixes the shape of every hook screens call. The signatures are fixed
 * by core/api.ts; each hook body belongs to the feature named in its placeholder, and that feature
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
 * Groups, one file per store or service, under core/hooks/:
 *   repos.ts      useRepos, useRepoConfig
 *   workspaces.ts useWorkspaces, useWorkspace, useWorkspaceStatus, useBacklogWorkspaces,
 *                 useSetupState, useInstalledApps, useAppIcon
 *   sections.ts   useSections
 *   chats.ts      useSessions, useChat, useClosedSessions, usePlans, useChangedSinceTurn
 *   composer.ts   useDraft, useSnippets
 *   git.ts        useGitState, useChangedFiles, useFileDiff, useBranchCommits, useBranches
 *   github.ts     useCheckLog, usePullRequestActivity, useStack, useIssues, usePullRequestList,
 *                 useGitHubAccess, useGitHubOwners, useGitHubRepos, useRepoNameCheck
 *   linear.ts     useLinearAccess
 *   files.ts      useFileTree, useFileContent, useFileSearch, useContentSearch,
 *                 useRepoFileSearch, useArtifacts
 *   review.ts     useDiffComments
 *   terminals.ts  useTerminals, useRunState, useTerminalConnection, useRepoTerminals
 *   settings.ts   useSetting, useEnvVars, useMcpServers
 *   agents.ts     useAgentInstalls, useModels, useSlashCommands, usePreWorkspaceSlashCommands,
 *                 useProviderKeys, useAgentProviders, useAcpConfigOptions, useAgentConfigFile,
 *                 useConfigSyncPreview
 *   commands.ts   useShortcutOverrides, useCommands, useLiveShortcut
 *   system.ts     useUpdateStatus, useDiagnostics, useAgentPrograms, useHelperPrograms, useSystemInfo,
 *                 useFullDiskAccess
 * Test first: useActions returns the action table of the container it is given. The test for a
 * hook body lives with the feature that implements it (for example NAV-03 for useWorkspaces).
 */
import type { Actions } from "./api.ts";
import { useServices } from "./context.tsx";

export * from "./hooks/agents.ts";
export * from "./hooks/chats.ts";
export * from "./hooks/commands.ts";
export * from "./hooks/composer.ts";
export * from "./hooks/files.ts";
export * from "./hooks/git.ts";
export * from "./hooks/github.ts";
export * from "./hooks/linear.ts";
export * from "./hooks/repos.ts";
export * from "./hooks/review.ts";
export * from "./hooks/sections.ts";
export * from "./hooks/settings.ts";
export * from "./hooks/system.ts";
export * from "./hooks/terminals.ts";
export * from "./hooks/workspaces.ts";

/** All mutations, grouped by area. Each returns a Result and never throws for expected failures. */
export const useActions = (): Actions => useServices().actions;
