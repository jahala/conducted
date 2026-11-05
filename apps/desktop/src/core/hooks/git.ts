/**
 * @feature DATA-01 Query hook contract for screens
 * @feature WS-02 Create from a branch, PR or issue
 * Owns: the git hooks: state, changed files, file diffs, branch commits and branches.
 * Behaviour: services-map.md 2.5 (queries for git data); core/hooks.ts states the contract.
 * Must handle: a branch whose commits cannot be read, a diff query that fails.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { type AppError, appError, type WorkspaceId } from "@conducted/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useStore } from "zustand";
import type { ChangedFile, DiffScope, FileDiff, Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { BranchCommit, GitState } from "../model.ts";
import { useSetting } from "./settings.ts";

export const useGitState: Queries["useGitState"] = (workspaceId) => {
	const { services } = useServices();
	const entry = useStore(services.git.store, (state) => state.byWorkspace[workspaceId]);
	const prEntry = useStore(services.github.store, (state) => state.byWorkspace[workspaceId]);
	return useMemo<Loadable<GitState>>(() => {
		if (entry === undefined || (entry.snapshot === null && entry.error === null)) {
			return { state: "loading" };
		}
		if (entry.snapshot === null) {
			return {
				state: "error",
				error: appError(
					entry.error?.code ?? "git_failed",
					entry.error?.message ?? "The git state could not be read.",
				),
			};
		}
		const state = services.git.stateOf(
			workspaceId,
			prEntry,
			services.github.pendingAction(workspaceId),
		);
		return state === null ? { state: "loading" } : { state: "ready", data: state };
	}, [services.git, services.github, workspaceId, entry, prEntry]);
};
const changedFilesKey = (workspaceId: WorkspaceId, scope: DiffScope) =>
	["git", "workspace", workspaceId, "changes", scope] as const;

export const useChangedFiles: Queries["useChangedFiles"] = (workspaceId, scope) => {
	const git = useServices().services.git;
	const query = useQuery<ChangedFile[], AppError>({
		queryKey: changedFilesKey(workspaceId, scope),
		queryFn: async () => {
			const result = await git.changedFiles(workspaceId, scope);
			if (!result.ok) throw result.error;
			return result.value;
		},
		staleTime: 0,
		refetchInterval: 5_000,
	});
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};
export const useFileDiff: Queries["useFileDiff"] = (workspaceId, path, scope) => {
	const { services } = useServices();
	const hideWhitespace = useSetting<boolean>("hide_whitespace_changes");
	const query = useQuery<FileDiff, AppError>({
		queryKey: ["git", "workspace", workspaceId, "file-diff", path, scope, hideWhitespace],
		queryFn: async () => {
			const result = await services.fileDiff.load(workspaceId, path, scope, {
				withPatch: false,
				ignoreWhitespace: hideWhitespace,
			});
			if (!result.ok) throw result.error;
			return result.value;
		},
		staleTime: 0,
	});
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};
export const useBranchCommits: Queries["useBranchCommits"] = (workspaceId) => {
	const git = useServices().services.git;
	const entry = useStore(git.store, (state) => state.byWorkspace[workspaceId]);
	return useMemo<Loadable<BranchCommit[]>>(() => {
		if (entry === undefined || (entry.snapshot === null && entry.error === null)) {
			return { state: "loading" };
		}
		if (entry.snapshot === null) {
			return {
				state: "error",
				error: appError(
					entry.error?.code ?? "git_failed",
					entry.error?.message ?? "The branch's commits could not be read.",
				),
			};
		}
		return {
			state: "ready",
			data: entry.snapshot.commits.map((commit) => ({
				sha: commit.hash,
				shortSha: commit.hash.slice(0, 7),
				subject: commit.subject,
				authorName: commit.authorName,
				at: commit.authoredAt * 1000,
			})),
		};
	}, [entry]);
};
export const useBranches: Queries["useBranches"] = (repoId) => {
	const { services } = useServices();
	const repo = useStore(services.repo.store, (state) => state.reposById[repoId]);
	const query = useQuery<string[], AppError>({
		queryKey: ["git", "branches", repoId],
		enabled: repo !== undefined,
		queryFn: async () => {
			if (repo === undefined) throw appError("repo_unknown", "That project was removed.");
			const found = await services.git.listBranches(repo.rootPath);
			if (!found.ok) throw found.error;
			return found.value;
		},
		staleTime: 5_000,
	});
	if (repo === undefined) return { state: "loading" };
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};
