/**
 * @feature REV-04 Sync review comments with GitHub
 * Tests the Checks tab's GitHub resolve: it resolves the thread on GitHub and shows
 * "Comment resolved on GitHub" only after GitHub accepted it.
 * Behaviour: services-map.md 5A.7.3 (resolve on GitHub) and inventory:toast main row 455.
 * Test first: clicking Resolve on a GitHub comment shows "Comment resolved on GitHub".
 */
import { appError, err, ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { PullRequest } from "../../../core/model.ts";
import type { GithubReviewThread } from "../../../core/services/github.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { ChecksTab } from "./ChecksTab.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
});

const pullRequest: PullRequest = {
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "Add the checks tab",
	body: "",
	state: "open",
	mergeable: "unknown",
	reviewDecision: null,
	checks: [],
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

function thread(): GithubReviewThread {
	return {
		id: "PRT_1",
		isOutdated: false,
		isResolved: false,
		path: "src/a.ts",
		line: 4,
		startLine: null,
		originalLine: 4,
		originalStartLine: null,
		startDiffSide: null,
		diffSide: "RIGHT",
		comments: [
			{
				id: "PRRC_1",
				databaseId: 101,
				body: "Please rename this.",
				url: "https://github.com/o/r/pull/12#discussion_r101",
				authorLogin: "octocat",
				authorAvatarUrl: null,
				createdAt: 1_000,
				updatedAt: 2_000,
				lastEditedAt: null,
				diffHunk: null,
				replyToId: null,
				replyToDatabaseId: null,
			},
		],
		commentsHasNextPage: false,
		commentsEndCursor: null,
	};
}

async function mountWithComment(container: TestContainer): Promise<void> {
	const workspace = await seedWorkspace(container.container);
	container.container.services.git.store.setState((state) => ({
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
	container.container.services.github.store.setState((state) => ({
		...state,
		byWorkspace: {
			...state.byWorkspace,
			[workspace.id]: { pullRequest, unavailable: "none", fetchedAt: 1 },
		},
	}));
	vi.spyOn(container.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
	vi.spyOn(container.container.services.github, "readReviewThreads").mockResolvedValue(
		ok([thread()]),
	);
	await container.container.services.review.syncFromGithub(workspace.id);

	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<ServicesProvider container={container.container}>
			<QueryClientProvider client={client}>
				<ChecksTab workspaceId={workspace.id} />
				<Toaster />
			</QueryClientProvider>
		</ServicesProvider>,
	);
}

describe("REV-04 Checks tab resolve on GitHub", () => {
	it("shows 'Comment resolved on GitHub' after GitHub accepted the resolve", async () => {
		test = createTestContainer();
		const resolve = vi
			.spyOn(test.container.services.github, "resolveReviewThread")
			.mockResolvedValue(ok(undefined));
		await mountWithComment(test);

		fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));

		await waitFor(() => expect(resolve).toHaveBeenCalled());
		expect(await screen.findByText("Comment resolved on GitHub")).toBeTruthy();
	});

	it("shows the failure and no success when GitHub refuses the resolve", async () => {
		test = createTestContainer();
		vi.spyOn(test.container.services.github, "resolveReviewThread").mockResolvedValue(
			err(appError("github_failed", "GitHub refused the resolve.")),
		);
		await mountWithComment(test);

		fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));

		expect(await screen.findByText("Couldn't resolve the comment")).toBeTruthy();
		expect(screen.queryByText("Comment resolved on GitHub")).toBeNull();
	});
});
