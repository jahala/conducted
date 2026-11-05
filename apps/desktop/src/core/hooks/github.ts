/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the GitHub hooks: access, checks, pull requests, issues and repository lists.
 * Behaviour: services-map.md 2.5 (queries for GitHub data); core/hooks.ts states the contract.
 * Must handle: a GitHub token of unknown status, a check log that cannot be read.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import { useMemo } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
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
export const useGitHubOwners: Queries["useGitHubOwners"] = () => notImplemented("PRJ-02");
export const useGitHubRepos: Queries["useGitHubRepos"] = () => notImplemented("PRJ-02");
export const useRepoNameCheck: Queries["useRepoNameCheck"] = () => notImplemented("PRJ-03");
