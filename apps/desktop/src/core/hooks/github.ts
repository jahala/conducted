/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the GitHub hooks: access, checks, pull requests, issues, and the owners and repositories
 * the clone picker lists (PRJ-02).
 * Behaviour: services-map.md 2.5 (queries for GitHub data); core/hooks.ts states the contract.
 * Must handle: a GitHub token of unknown status, a check log that cannot be read.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { type AppError, appError, notImplemented } from "@conducted/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { GitHubOwner, GitHubRepoSummary } from "../model.ts";
import { toGitHubAccessView } from "../services/github.ts";

export const useCheckLog: Queries["useCheckLog"] = () => notImplemented("PR-04");
export const usePullRequestActivity: Queries["usePullRequestActivity"] = () =>
	notImplemented("PR-07");
export const useStack: Queries["useStack"] = () => notImplemented("PR-08");
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
export const useIssues: Queries["useIssues"] = () => notImplemented("PR-11");
export const usePullRequestList: Queries["usePullRequestList"] = () => notImplemented("PR-11");
export const useGitHubOwners: Queries["useGitHubOwners"] = () => {
	const { services } = useServices();
	const access = useStore(services.github.store, (state) => state.access);
	const loading = access.status === "unknown" && access.reason === undefined;
	const available = access.status === "ok";
	const login = access.status === "ok" ? access.login : null;
	const result = useQuery<GitHubOwner[], AppError>({
		queryKey: ["github", "owners", login],
		enabled: available,
		queryFn: async () => {
			const found = await services.github.listOwners();
			if (!found.ok) throw found.error;
			return found.value;
		},
		staleTime: 5 * 60_000,
	});
	if (loading) return { state: "loading" };
	if (!available) {
		return {
			state: "error",
			error: appError("github_owners_unavailable", "Sign in to GitHub to choose a repository."),
		};
	}
	if (result.isError && result.error !== null) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
};

export const useGitHubRepos: Queries["useGitHubRepos"] = (owner, query) => {
	const { services } = useServices();
	const access = useStore(services.github.store, (state) => state.access);
	const loading = access.status === "unknown" && access.reason === undefined;
	const available = access.status === "ok";
	const login = access.status === "ok" ? access.login : null;
	const target = owner ?? login;
	const result = useQuery<GitHubRepoSummary[], AppError>({
		queryKey: ["github", "repos", target, query],
		enabled: available && target !== null,
		queryFn: async () => {
			if (target === null) {
				throw appError("github_owner_missing", "Sign in to GitHub to choose a repository.");
			}
			const found = await services.github.listRepositories(target, query);
			if (!found.ok) throw found.error;
			return found.value;
		},
		staleTime: 30_000,
	});
	if (loading) return { state: "loading" };
	if (!available || target === null) {
		return {
			state: "error",
			error: appError("github_repos_unavailable", "Sign in to GitHub to choose a repository."),
		};
	}
	if (result.isError && result.error !== null) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
};
export const useRepoNameCheck: Queries["useRepoNameCheck"] = () => notImplemented("PRJ-03");
