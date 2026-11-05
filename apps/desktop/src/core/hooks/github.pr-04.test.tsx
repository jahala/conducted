import { ok, type WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import type { PullRequest } from "../model.ts";
import type { WorkspacePrEntry } from "../services/github.ts";
import { useCheckLog } from "./github.ts";

const workspaceId = "w1" as WorkspaceId;

const pullRequest: PullRequest = {
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "Add the checks tab",
	body: "",
	state: "open",
	mergeable: "unknown",
	reviewDecision: null,
	checks: [
		{
			name: "Build",
			state: "failure",
			url: "https://github.com/o/r/actions/runs/9/job/7",
			startedAt: null,
			completedAt: null,
			required: true,
		},
	],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "octocat",
	viewerDidAuthor: false,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
};

let test: TestContainer;

function setEntry(entry: WorkspacePrEntry) {
	test.container.services.github.store.setState((state) => ({
		...state,
		byWorkspace: { [workspaceId]: entry },
	}));
}

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return (
		<ServicesProvider container={test.container}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</ServicesProvider>
	);
}

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	test.close();
});

describe("PR-04 useCheckLog", () => {
	it("loads the log of the named check through the real container", async () => {
		setEntry({ pullRequest, unavailable: "none", fetchedAt: 1 });
		const read = vi
			.spyOn(test.container.services.github, "readCheckLog")
			.mockResolvedValue(ok("the log"));
		const { result } = renderHook(() => useCheckLog(workspaceId, "Build"), { wrapper });
		await waitFor(() => expect(result.current).toEqual({ state: "ready", data: "the log" }));
		expect(read).toHaveBeenCalledWith(workspaceId, "https://github.com/o/r/actions/runs/9/job/7");
	});

	it("says there are no logs for a check the pull request does not have", () => {
		setEntry({ pullRequest, unavailable: "none", fetchedAt: 1 });
		const read = vi.spyOn(test.container.services.github, "readCheckLog");
		const { result } = renderHook(() => useCheckLog(workspaceId, "Missing"), { wrapper });
		expect(result.current.state).toBe("error");
		expect(read).not.toHaveBeenCalled();
	});
});
