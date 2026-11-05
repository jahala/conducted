/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the file hooks: trees, file text, searches and the artifact pages.
 * Behaviour: services-map.md 2.5 (queries for file data); core/hooks.ts states the contract. The
 * file tree is a query with its own key, polled every 30 s while shown, and stale after 15 s
 * (services-map.md 5A.5.3). It is not the git changes poll (REV-06).
 * Must handle: a file that no longer exists, a search that returns nothing.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { type AppError, notImplemented } from "@conducted/shared";
import { useQuery } from "@tanstack/react-query";
import type { FileEntry, Queries } from "../api.ts";
import { useServices } from "../context.tsx";

export const useFileTree: Queries["useFileTree"] = (workspaceId) => {
	const service = useServices().services.workspaceFiles;
	const query = useQuery<FileEntry[], AppError>({
		queryKey: ["workspace-files", workspaceId],
		queryFn: async () => {
			const result = await service.tree(workspaceId);
			if (!result.ok) throw result.error;
			return result.value;
		},
		staleTime: 15_000,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};
export const useFileContent: Queries["useFileContent"] = () => notImplemented("REV-08");
export const useFileSearch: Queries["useFileSearch"] = () => notImplemented("REV-07");
export const useContentSearch: Queries["useContentSearch"] = () => notImplemented("REV-07");
export const useRepoFileSearch: Queries["useRepoFileSearch"] = () => notImplemented("COMP-04");
export const useArtifacts: Queries["useArtifacts"] = () => notImplemented("REV-10");
