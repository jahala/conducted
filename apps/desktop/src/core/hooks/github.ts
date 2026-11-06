/**
 * @feature DATA-01 Query hook contract for screens
 * @feature PRJ-03 The repository-name check hook the Create project dialog shows
 * Owns: the GitHub hooks: access, checks, pull requests, issues and repository lists.
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
import type {
	GitHubOwner,
	GitHubRepoSummary,
	IssueView,
	PullRequestSummary,
	RepoNameCheck,
} from "../model.ts";
import {
	canListGithubIssues,
	canListGithubPullRequests,
	toGitHubAccessView,
} from "../services/github.ts";
import { projectFolderName } from "../services/project-templates.ts";

export const useCheckLog: Queries["useCheckLog"] = (workspaceId, checkName) => {
	const { services } = useServices();
	const entry = useStore(services.github.store, (state) => state.byWorkspace[workspaceId]);
	const pullRequest = entry?.pullRequest ?? null;
	const check = pullRequest?.checks.find((candidate) => candidate.name === checkName) ?? null;
	const url = check?.url ?? null;
	const result = useQuery<string, AppError>({
		queryKey: ["github", "check-log", workspaceId, checkName, url],
		enabled: check !== null,
		// A finished check's log does not change, so reopening the row reuses the first answer.
		staleTime: Number.POSITIVE_INFINITY,
		queryFn: async () => {
			const found = await services.github.readCheckLog(workspaceId, url);
			if (!found.ok) throw found.error;
			return found.value;
		},
	});
	if (entry === undefined || (entry.pullRequest === null && entry.unavailable === "loading")) {
		return { state: "loading" };
	}
	if (check === null) {
		return { state: "error", error: appError("github_check_missing", "No logs available.") };
	}
	if (result.isError && result.error !== null) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
};
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
export const useIssues: Queries["useIssues"] = (repoId, provider, query) => {
	const { services } = useServices();
	const repo = useStore(services.repo.store, (state) => state.reposById[repoId]);
	const access = useStore(services.github.store, (state) => state.access);
	const github = provider === "github";
	const accessLoading = github && access.status === "unknown" && access.reason === undefined;
	const available = !github || canListGithubIssues(repo?.remoteUrl ?? null, access);
	const result = useQuery<IssueView[], AppError>({
		queryKey: ["github", "issues", repoId, provider, query],
		enabled: available && !accessLoading && (!github || repo !== undefined),
		queryFn: async () => {
			if (!github) notImplemented("PR-09");
			if (repo === undefined) throw appError("repo_unknown", "That project was removed.");
			if (repo.remoteUrl === null) {
				throw appError("github_not_github", "This repository has no GitHub remote.");
			}
			const found = await services.github.listIssues(repo.remoteUrl, query);
			if (!found.ok) throw found.error;
			return found.value;
		},
		staleTime: 30_000,
	});
	if (accessLoading || (github && repo === undefined)) return { state: "loading" };
	if (!available) {
		return {
			state: "error",
			error: appError(
				"github_issues_unavailable",
				"GitHub issues need a GitHub remote and a working GitHub sign-in.",
			),
		};
	}
	if (result.isError && result.error !== null) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
};

export const usePullRequestList: Queries["usePullRequestList"] = (repoId, query) => {
	const { services } = useServices();
	const repo = useStore(services.repo.store, (state) => state.reposById[repoId]);
	const available = canListGithubPullRequests(repo?.remoteUrl ?? null);
	const result = useQuery<PullRequestSummary[], AppError>({
		queryKey: ["github", "pullRequests", repoId, query],
		enabled: available && repo !== undefined,
		queryFn: async () => {
			if (repo === undefined) throw appError("repo_unknown", "That project was removed.");
			if (repo.remoteUrl === null) {
				throw appError("github_not_github", "This repository has no GitHub remote.");
			}
			const found = await services.github.listPullRequests(repo.remoteUrl, query);
			if (!found.ok) throw found.error;
			return found.value;
		},
		staleTime: 30_000,
	});
	if (repo === undefined) return { state: "loading" };
	if (!available) {
		return {
			state: "error",
			error: appError("github_not_github", "This repository has no GitHub remote."),
		};
	}
	if (result.isError && result.error !== null) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
};
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
export const useRepoNameCheck: Queries["useRepoNameCheck"] = (owner, name) => {
	const { services } = useServices();
	const access = useStore(services.github.store, (state) => state.access);
	const loading = access.status === "unknown" && access.reason === undefined;
	const available = access.status === "ok";
	const trimmedOwner = owner.trim();
	const folder = projectFolderName(name);
	const invalid = name.trim() !== "" && folder === "";
	const result = useQuery<RepoNameCheck, AppError>({
		queryKey: ["github", "repo-name", trimmedOwner, folder],
		enabled: available && trimmedOwner !== "" && folder !== "" && !invalid,
		queryFn: async () => {
			const found = await services.github.checkRepoName(trimmedOwner, folder);
			if (!found.ok) throw found.error;
			return found.value;
		},
	});
	if (invalid) return { state: "ready", data: "invalid" };
	if (loading) return { state: "loading" };
	if (!available) {
		return {
			state: "error",
			error: appError(
				"github_repo_name_unavailable",
				"Sign in to GitHub to check a repository name.",
			),
		};
	}
	if (trimmedOwner === "" || folder === "") return { state: "loading" };
	if (result.isError && result.error !== null) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
};
