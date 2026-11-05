/**
 * @feature PR-11 List and attach GitHub issues and pull requests
 * Behaviour: services-map.md 2.5.2 (GitHub reads), 5B.8.2 (the issues tab needs a GitHub remote
 * and a working sign-in).
 * Test first: with no GitHub remote the hook reports the tab unavailable and makes no request.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Container } from "../container.ts";
import { ServicesProvider } from "../context.tsx";
import type { IssueView, PullRequestSummary, Repo } from "../model.ts";
import type { GithubAccess } from "../services/github.ts";
import { useIssues, usePullRequestList } from "./github.ts";

const repoId = "repo-1" as Repo["id"];
const remoteUrl = "https://github.com/octo/repo.git";

afterEach(cleanup);

const readyAccess: GithubAccess = {
	status: "ok",
	login: "ada",
	host: "github.com",
	scopes: ["repo"],
	usesToken: false,
	gitProtocol: "https",
};

const issue: IssueView = {
	provider: "github",
	id: "7",
	identifier: "#7",
	title: "The list loses its place",
	url: "https://github.com/octo/repo/issues/7",
	state: "open",
	branchName: null,
	updatedAt: Date.parse("2026-11-05T10:00:00Z"),
};

const pullRequest: PullRequestSummary = {
	number: 12,
	title: "Keep the list in place",
	branch: "feature/list",
	authorLogin: "ada",
	authorAvatarUrl: null,
	state: "open",
	updatedAt: Date.parse("2026-11-05T09:00:00Z"),
};

function containerWith(options: {
	remoteUrl?: string | null;
	access?: GithubAccess;
	listIssues?: ReturnType<typeof vi.fn>;
	listPullRequests?: ReturnType<typeof vi.fn>;
}): Container {
	const repo: Repo = {
		id: repoId,
		name: "repo",
		rootPath: "/code/repo",
		remoteUrl: options.remoteUrl === undefined ? remoteUrl : options.remoteUrl,
		defaultBranch: "main",
		icon: null,
		displayOrder: 0,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
	};
	return {
		services: {
			repo: {
				store: createStore(() => ({ reposById: { [repoId]: repo } })),
			},
			github: {
				store: createStore(() => ({ access: options.access ?? readyAccess })),
				listIssues: options.listIssues ?? vi.fn(async () => ({ ok: true, value: [issue] })),
				listPullRequests:
					options.listPullRequests ?? vi.fn(async () => ({ ok: true, value: [pullRequest] })),
			},
			linear: { search: vi.fn() },
		},
	} as unknown as Container;
}

const wrapper = (container: Container) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
};

describe("PR-11 useIssues", () => {
	it("loads the repository's GitHub issues, filtered by the query", async () => {
		const listIssues = vi.fn(async () => ({ ok: true, value: [issue] }));
		const { result } = renderHook(() => useIssues(repoId, "github", "list"), {
			wrapper: wrapper(containerWith({ listIssues })),
		});

		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current).toEqual({ state: "ready", data: [issue] });
		expect(listIssues).toHaveBeenCalledWith(remoteUrl, "list");
	});

	it("reports the tab unavailable and makes no request without a GitHub remote", () => {
		const listIssues = vi.fn();
		const { result } = renderHook(() => useIssues(repoId, "github", ""), {
			wrapper: wrapper(containerWith({ remoteUrl: null, listIssues })),
		});

		expect(result.current.state).toBe("error");
		expect(result.current.state === "error" && result.current.error.code).toBe(
			"github_issues_unavailable",
		);
		expect(listIssues).not.toHaveBeenCalled();
	});

	it("reports the tab unavailable when GitHub access is not working", () => {
		const listIssues = vi.fn();
		const { result } = renderHook(() => useIssues(repoId, "github", ""), {
			wrapper: wrapper(containerWith({ access: { status: "signed_out" }, listIssues })),
		});

		expect(result.current.state).toBe("error");
		expect(listIssues).not.toHaveBeenCalled();
	});
});

describe("PR-11 usePullRequestList", () => {
	it("loads the repository's open pull requests, filtered by the query", async () => {
		const listPullRequests = vi.fn(async () => ({ ok: true, value: [pullRequest] }));
		const { result } = renderHook(() => usePullRequestList(repoId, "list"), {
			wrapper: wrapper(containerWith({ listPullRequests })),
		});

		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current).toEqual({ state: "ready", data: [pullRequest] });
		expect(listPullRequests).toHaveBeenCalledWith(remoteUrl, "list");
	});

	it("makes no request without a GitHub remote", () => {
		const listPullRequests = vi.fn();
		const { result } = renderHook(() => usePullRequestList(repoId, ""), {
			wrapper: wrapper(containerWith({ remoteUrl: null, listPullRequests })),
		});

		expect(result.current.state).toBe("error");
		expect(listPullRequests).not.toHaveBeenCalled();
	});
});
