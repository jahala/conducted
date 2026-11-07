/**
 * @feature GIT-04 Git header state machine
 * Owns: the test that the header's "Add all comments to chat", shown when a reviewer asked for
 * changes, sends the pull request's open GitHub comments to the chat, and is offered only while
 * one of them has not been sent yet.
 * Behaviour: ui-map.md 3.6 (changes requested: "Add all comments to chat"); Conductor offers it
 * only when a comment is not in the chat yet (renderApp @2262911).
 * Test first: clicking the header's "Add all comments to chat" sends the open GitHub comment to the chat.
 */
import { ok } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import type { PullRequest, Workspace } from "../../core/model.ts";
import type { GithubReviewThread } from "../../core/services/github.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { GitPanel } from "./GitPanel.tsx";

let test: TestContainer | null = null;

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	if (test !== null) {
		await test.container.stop();
		test.close();
	}
	test = null;
});

const changesRequested: PullRequest = {
	number: 12,
	url: "https://github.com/me/project/pull/12",
	title: "A change",
	body: "",
	state: "open",
	mergeable: "mergeable",
	reviewDecision: "changes_requested",
	checks: [],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "octocat",
	viewerDidAuthor: true,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
};

const thread: GithubReviewThread = {
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
			url: "https://github.com/me/project/pull/12#discussion_r101",
			authorLogin: "lee",
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

/** A pushed branch whose pull request has changes requested, and its synced GitHub comments. */
async function seedPanel(threads: GithubReviewThread[]): Promise<Workspace> {
	test = createTestContainer();
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id, branch: "feat" });
	test.container.services.git.store.setState({
		byWorkspace: {
			[workspace.id]: {
				snapshot: {
					depth: "full",
					branch: "feat",
					mergeBase: "abc123",
					mergeBaseError: null,
					files: [],
					conflictedPaths: [],
					untrackedTruncated: false,
					uncommittedFiles: 0,
					changedFiles: 1,
					operation: "none",
					commits: [],
					sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
					behindTarget: 0,
				},
				error: null,
				refreshedAt: 1,
			},
		},
	});
	test.container.services.github.store.setState({
		byWorkspace: {
			[workspace.id]: { pullRequest: changesRequested, unavailable: "none", fetchedAt: 1 },
		},
	});
	// seam: GIT-04 GitHub's review threads, read through gh, are the input under test.
	vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(ok(threads));
	vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
	const synced = await test.container.services.review.syncFromGithub(workspace.id);
	if (!synced.ok) throw new Error(synced.error.message);
	return workspace;
}

async function renderPanel(workspace: Workspace): Promise<void> {
	if (test === null) throw new Error("Seed the panel first.");
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<CommandDispatcher>
				<GitPanel workspaceId={workspace.id} />
			</CommandDispatcher>
		),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
}

describe("GIT-04 Add all comments to chat", () => {
	it("clicking the header's Add all comments to chat sends the open GitHub comment to the chat", async () => {
		const workspace = await seedPanel([thread]);
		if (test === null) throw new Error("Seed the panel first.");
		const comments = test.container.services.review.store.getState().byWorkspace[workspace.id];
		const commentId = comments?.[0]?.id;
		expect(commentId).toBeDefined();
		const send = vi
			.spyOn(test.container.actions.comments, "sendToChat")
			.mockResolvedValue(ok(undefined));
		await renderPanel(workspace);
		await screen.findByText("PR changes requested");

		fireEvent.click(await screen.findByRole("button", { name: "Add all comments to chat" }));

		await waitFor(() => expect(send).toHaveBeenCalledWith(workspace.id, [commentId]));
	});

	it("offers no Add all comments to chat when every comment is resolved", async () => {
		const workspace = await seedPanel([{ ...thread, isResolved: true }]);
		await renderPanel(workspace);
		await screen.findByText("PR changes requested");

		expect(screen.queryByRole("button", { name: "Add all comments to chat" })).toBeNull();
	});
});
