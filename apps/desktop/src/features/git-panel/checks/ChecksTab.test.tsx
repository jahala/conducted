import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { PullRequest } from "../../../core/model.ts";
import { createTestContainer, seedWorkspace } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { ChecksTab } from "./ChecksTab.tsx";

const shown = vi.hoisted(() => ({ comments: [] as unknown[] }));

vi.mock("../../../core/hooks/review.ts", () => ({
	useDiffComments: () => ({ state: "ready", data: shown.comments }),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	shown.comments = [];
});

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

	async function mountWithPullRequest(shownPullRequest: PullRequest | null = pullRequest) {
		const test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		test.container.services.git.store.setState((state) => ({
			...state,
			byWorkspace: {
				...state.byWorkspace,
				[workspace.id]: {
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
				[workspace.id]: { pullRequest: shownPullRequest, unavailable: "none", fetchedAt: 1 },
			},
		}));
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<ServicesProvider container={test.container}>
				<QueryClientProvider client={client}>
					<ChecksTab workspaceId={workspace.id} />
				</QueryClientProvider>
			</ServicesProvider>,
		);
		return { test, workspace };
	}

	it("opens the pull request's own page instead of creating one", async () => {
		const { test } = await mountWithPullRequest();
		try {
			const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");
			const create = vi.spyOn(test.container.actions.pullRequests, "openOnGithub");

			fireEvent.click(await screen.findByRole("button", { name: "Open on GitHub" }));

			await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/12"));
			expect(create).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("opens GitHub's new pull request page from Create PR through the action", async () => {
		const { test, workspace } = await mountWithPullRequest(null);
		try {
			const create = vi
				.spyOn(test.container.actions.pullRequests, "openOnGithub")
				.mockResolvedValue(ok(undefined));

			fireEvent.click(await screen.findByRole("button", { name: "Create PR" }));

			await waitFor(() => expect(create).toHaveBeenCalledWith(workspace.id));
		} finally {
			test.close();
		}
	});

	it("hides a GitHub comment through the action", async () => {
		shown.comments = [
			{
				id: "c1",
				workspaceId: "w1",
				filePath: "src/app.ts",
				line: 4,
				endLine: null,
				body: "Rename this",
				author: { kind: "github", name: "ada", avatarUrl: null },
				state: "pending",
				side: "additions",
				threadId: "c1",
				replyToId: null,
				suggestion: null,
				remoteUrl: null,
				resolved: false,
				outdated: false,
				createdAt: 0,
				updatedAt: 0,
			},
		];
		const { test } = await mountWithPullRequest();
		try {
			const hide = vi
				.spyOn(test.container.actions.comments, "setHidden")
				.mockResolvedValue(ok(undefined));
			expect(await screen.findByText("Rename this")).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Hide" }));

			await waitFor(() => expect(hide).toHaveBeenCalledWith("c1", true));
		} finally {
			test.close();
		}
	});
});
