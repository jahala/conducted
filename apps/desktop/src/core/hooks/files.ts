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
import type { ContentMatch, FileEntry, Queries } from "../api.ts";
import { useServices } from "../context.tsx";

/** Search in files shows this many matches; the service returns one more when the list was cut. */
export { CONTENT_SEARCH_LIMIT } from "../services/workspace-files.ts";

/** Both dialogs wait for a second character, and the picker shows the best 50 names. */
const MIN_QUERY_LENGTH = 2;
const QUICK_OPEN_LIMIT = 50;

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
export const useFileSearch: Queries["useFileSearch"] = (workspaceId, query) => {
	const workspaceFiles = useServices().services.workspaceFiles;
	const trimmed = query.trim();
	const enabled = trimmed.length >= MIN_QUERY_LENGTH;
	const result = useQuery<FileEntry[], AppError>({
		queryKey: ["files", "quick-open", workspaceId, trimmed],
		queryFn: async () => {
			const found = await workspaceFiles.quickOpen(workspaceId, trimmed, QUICK_OPEN_LIMIT);
			if (!found.ok) throw found.error;
			return found.value;
		},
		enabled,
		staleTime: 0,
	});
	if (!enabled) return { state: "ready", data: [] };
	if (result.isError) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
};
export const useContentSearch: Queries["useContentSearch"] = (workspaceId, query, options) => {
	const workspaceFiles = useServices().services.workspaceFiles;
	const trimmed = query.trim();
	const enabled = trimmed.length >= MIN_QUERY_LENGTH;
	const result = useQuery<ContentMatch[], AppError>({
		queryKey: [
			"files",
			"content-search",
			workspaceId,
			trimmed,
			options.matchCase,
			options.wholeWord,
			options.regex,
		],
		queryFn: async () => {
			const found = await workspaceFiles.grep(workspaceId, trimmed, {
				caseSensitive: options.matchCase,
				wholeWord: options.wholeWord,
				regex: options.regex,
			});
			if (!found.ok) throw found.error;
			return found.value;
		},
		enabled,
		staleTime: 0,
	});
	if (!enabled) return { state: "ready", data: [] };
	if (result.isError) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
};
export const useRepoFileSearch: Queries["useRepoFileSearch"] = () => notImplemented("COMP-04");
export const useArtifacts: Queries["useArtifacts"] = () => notImplemented("REV-10");
