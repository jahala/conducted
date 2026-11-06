/**
 * @feature DATA-01 Query hook contract for screens
 * @feature REV-08 File content query and the editor's draft for the viewer
 * @feature REV-10 Artifact pages query
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: the file hooks: trees, file text, workspace and repository searches, and the artifact
 * pages; and, outside the Queries contract, `useFileDraft` (the editor's unsaved draft of one file)
 * and `fileQueryKey`. `useRepoFileSearch` searches a repository's main clone before a workspace
 * exists, for the new-workspace composer's `@` menu (SIDE-22).
 * Behaviour: services-map.md 2.5 (queries for file data), 2.5.2 (an open file's modified time is
 * polled every 5 s); core/hooks.ts states the contract. The file tree is a query with its own key,
 * polled every 30 s while shown, and stale after 15 s (services-map.md 5A.5.3). It is not the git
 * changes poll (REV-06).
 * Our design choice: `useFileContent` polls only the modified time. The text is read again only
 * when that time changes: the time is part of the text query's key, and the old text stays on
 * screen while the new one loads.
 * Must handle: a file that no longer exists (the time reads null), a search that returns nothing,
 * a save that succeeded (the saved text is shown at once, without a read), and a save refused
 * because the disk moved on (the file is read again so the banner shows).
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { type AppError, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useStore } from "zustand";
import type { ContentMatch, FileEntry, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { FileContent } from "../model.ts";
import { type FileDraft, fileDraftKey } from "../services/workspace-files.ts";

/** Search in files shows this many matches; the service returns one more when the list was cut. */
export { CONTENT_SEARCH_LIMIT, type FileDraft, previewUrlOf } from "../services/workspace-files.ts";

/** How often an open file's modified time is read (services-map.md 2.5.2). */
const FILE_POLL_MS = 5_000;

/** The prefix of every query about one file: invalidating it reads the time and the text again. */
export const fileQueryKey = (workspaceId: WorkspaceId, path: string) =>
	["files", "content", workspaceId, path] as const;
const modifiedAtKey = (workspaceId: WorkspaceId, path: string) =>
	[...fileQueryKey(workspaceId, path), "modified-at"] as const;
const textKey = (workspaceId: WorkspaceId, path: string, modifiedAt: number | null) =>
	[...fileQueryKey(workspaceId, path), "text", modifiedAt] as const;

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
export const useFileContent: Queries["useFileContent"] = (workspaceId, path) => {
	const service = useServices().services.workspaceFiles;
	const modifiedAt = useQuery<number | null, AppError>({
		queryKey: modifiedAtKey(workspaceId, path),
		queryFn: async () => {
			const result = await service.modifiedAtOf(workspaceId, path);
			if (!result.ok) throw result.error;
			return result.value;
		},
		staleTime: 0,
		refetchInterval: FILE_POLL_MS,
	});
	const query = useQuery<FileContent, AppError>({
		queryKey: textKey(workspaceId, path, modifiedAt.data ?? null),
		queryFn: async () => {
			const result = await service.readContent(workspaceId, path);
			if (!result.ok) throw result.error;
			return result.value;
		},
		enabled: modifiedAt.data !== undefined,
		staleTime: Number.POSITIVE_INFINITY,
		placeholderData: keepPreviousData,
	});
	if (modifiedAt.isError && modifiedAt.error !== null) {
		return { state: "error", error: modifiedAt.error };
	}
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};

export interface FileDraftHandle {
	/** The unsaved edits, or undefined when the file is clean. */
	draft: FileDraft | undefined;
	/** Records the user's edit against the disk text it started from (null when deleted). */
	edit: (text: string, disk: { text: string; modifiedAt: number } | null) => void;
	discard: () => void;
	/** Keep mine. Null means the file was deleted on disk. */
	keep: (diskModifiedAt: number | null) => void;
	/** Saves the draft and shows the saved text at once. `ok(false)` when nothing was saved. */
	save: () => Promise<Result<boolean>>;
}

/** The editor's unsaved draft of one file. It outlives the tab (see WorkspaceFilesService). */
export function useFileDraft(workspaceId: WorkspaceId, path: string): FileDraftHandle {
	const service = useServices().services.workspaceFiles;
	const queryClient = useQueryClient();
	const draft = useStore(service.drafts, (state) => state.drafts[fileDraftKey(workspaceId, path)]);
	return {
		draft,
		edit: (text, disk) => service.editDraft(workspaceId, path, text, disk),
		discard: () => service.discardDraft(workspaceId, path),
		keep: (diskModifiedAt) => service.keepDraft(workspaceId, path, diskModifiedAt),
		save: async () => {
			const saved = await service.saveDraft(workspaceId, path);
			if (!saved.ok) {
				if (saved.error.code === "changed_on_disk") {
					await queryClient.invalidateQueries({ queryKey: fileQueryKey(workspaceId, path) });
				}
				return saved;
			}
			if (saved.value === null) return ok(false);
			const { text, modifiedAt } = saved.value;
			const content: FileContent = {
				kind: "text",
				text,
				modifiedAt,
				sizeBytes: new TextEncoder().encode(text).length,
			};
			queryClient.setQueryData(textKey(workspaceId, path, modifiedAt), content);
			queryClient.setQueryData(modifiedAtKey(workspaceId, path), modifiedAt);
			return ok(true);
		},
	};
}
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
export const useRepoFileSearch: Queries["useRepoFileSearch"] = (repoId, query) => {
	const { services } = useServices();
	const workspaceFiles = services.workspaceFiles;
	const repo = useStore(services.repo.store, (state) => state.reposById[repoId]);
	const trimmed = query.trim();
	const enabled = trimmed.length >= MIN_QUERY_LENGTH && repo !== undefined;
	const result = useQuery<FileEntry[], AppError>({
		queryKey: ["files", "repo-quick-open", repoId, trimmed],
		queryFn: async () => {
			if (repo === undefined) return [];
			const found = await workspaceFiles.quickOpenRoot(repo.rootPath, trimmed, QUICK_OPEN_LIMIT);
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
export const useArtifacts: Queries["useArtifacts"] = (workspaceId) => {
	const service = useServices().services.workspaceFiles;
	const page = useStore(service.artifactsStore, (state) => state.byWorkspace[workspaceId]);
	useEffect(() => {
		void service.loadArtifacts(workspaceId);
	}, [service, workspaceId]);
	if (page === undefined || (page.loading && page.entries.length === 0)) {
		return { state: "loading" };
	}
	if (page.error !== null) return { state: "error", error: page.error };
	return {
		state: "ready",
		data: {
			entries: [...page.entries],
			hasMore: page.hasMore,
			omitted: page.omitted,
		},
	};
};
