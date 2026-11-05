import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { PullRequest } from "../../../core/model.ts";
import { createTestContainer, seedWorkspace } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { ChecksTab } from "./ChecksTab.tsx";

vi.mock("../../../core/hooks/review.ts", () => ({
	useDiffComments: () => ({ state: "ready", data: [] }),
}));

afterEach(cleanup);

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
			url: null,
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

describe("PR-04 Checks tab", () => {
	it("shows a failed check and offers to re-run it through the real container", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const workspaceId = workspace.id;

			test.container.services.git.store.setState((state) => ({
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspaceId]: {
						snapshot: {
							depth: "full",
							branch: "feat/checks",
							mergeBase: null,
							mergeBaseError: null,
							files: [],
							conflictedPaths: [],
							untrackedTruncated: false,
							uncommittedFiles: 0,
							changedFiles: 0,
							operation: "none",
							commits: [],
							sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
							behindTarget: 0,
						},
						error: null,
						refreshedAt: 1,
					},
				},
			}));
			test.container.services.github.store.setState((state) => ({
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspaceId]: { pullRequest, unavailable: "none", fetchedAt: 1 },
				},
			}));

			const rerun = vi
				.spyOn(test.container.actions.pullRequests, "rerunFailedChecks")
				.mockResolvedValue(ok(undefined));
			const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
			render(
				<ServicesProvider container={test.container}>
					<QueryClientProvider client={client}>
						<ChecksTab workspaceId={workspaceId} />
					</QueryClientProvider>
				</ServicesProvider>,
			);

			expect(await screen.findByText("Build")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Re-run failed checks" }));
			await waitFor(() => expect(rerun).toHaveBeenCalledWith(workspaceId));
		} finally {
			test.close();
		}
	});

	it("explains that checks need GitHub when the repository has no remote", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const workspaceId = workspace.id;
			test.container.services.git.store.setState((state) => ({
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspaceId]: {
						snapshot: {
							depth: "full",
							branch: "feat/checks",
							mergeBase: null,
							mergeBaseError: null,
							files: [],
							conflictedPaths: [],
							untrackedTruncated: false,
							uncommittedFiles: 0,
							changedFiles: 0,
							operation: "none",
							commits: [],
							sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
							behindTarget: 0,
						},
						error: null,
						refreshedAt: 1,
					},
				},
			}));
			test.container.services.github.store.setState((state) => ({
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspaceId]: { pullRequest: null, unavailable: "not_github", fetchedAt: 1 },
				},
			}));
			const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
			render(
				<ServicesProvider container={test.container}>
					<QueryClientProvider client={client}>
						<ChecksTab workspaceId={workspaceId} />
					</QueryClientProvider>
				</ServicesProvider>,
			);

			expect(await screen.findByText("Checks need GitHub.")).toBeTruthy();
		} finally {
			test.close();
		}
	});
});
