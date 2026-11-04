/**
 * @feature DATA-01 Query hooks and actions for screens
 * Owns: the hooks screens call. Each one reads a service store (core/services) and returns a
 * Loadable, so screens design their own loading and error states. The signatures are fixed by
 * core/api.ts; the UI core work replaces each placeholder with a real store subscription.
 * Behaviour: services-map.md 1.3 (services over zustand stores), 2.5 (query cache).
 * Must handle: a hook for an id that no longer exists returns an error state, never throws.
 * Test first: useWorkspaces returns "ready" with the rows a test database holds.
 */
import { notImplemented } from "@conducted/shared";
import type { Actions, Queries } from "./api.ts";

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

/** All mutations, grouped by area. Each returns a Result and never throws for expected failures. */
export const useActions = (): Actions => notImplemented("DATA-01");
