/**
 * @feature PR-07 PrTab
 * Owns: tests of the PR tab over the real container: a draft's merge bar and the branch commits,
 * the "#<number>" link and its right-click menu (Open in..., Copy link, Copy number), and an
 * activity comment opening the Comment tab.
 * Behaviour: ui-map.md 3.2, 5.3 and 6.
 * Test first: with a PR in state "draft" the merge bar shows "Mark ready" and no Merge button.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
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
import type { DiffComment, PullRequest, Workspace } from "../../core/model.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { PrTab } from "./PrTab.tsx";

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

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
	number: 12,
	url: "https://github.com/me/project/pull/12",
	title: "A change",
	body: "",
	state: "open",
	mergeable: "mergeable",
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
	...overrides,
});

async function seedTab(pr: PullRequest): Promise<{ test: TestContainer; workspace: Workspace }> {
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
					commits: [
						{
							hash: "abcdef1234567",
							subject: "Add the first commit",
							authorName: "Ada",
							authorEmail: "ada@example.com",
							authoredAt: 1_700_000_000,
						},
					],
					sync: { ahead: 1, behind: 0, rewritten: false, hasUpstream: true },
					behindTarget: 0,
				},
				error: null,
				refreshedAt: 1,
			},
		},
	});
	test.container.services.github.store.setState({
		byWorkspace: { [workspace.id]: { pullRequest: pr, unavailable: "none", fetchedAt: 1 } },
	});
	return { test, workspace };
}

async function renderTab(harness: TestContainer, workspace: Workspace) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<CommandDispatcher>
				<PrTab workspaceId={workspace.id} />
			</CommandDispatcher>
		),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={harness.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

const githubComment = (workspaceId: WorkspaceId): DiffComment => ({
	id: "comment-1" as CommentId,
	workspaceId,
	filePath: "src/app.ts",
	line: 4,
	endLine: null,
	body: "Rename this function",
	author: { kind: "github", name: "hubot", avatarUrl: null },
	state: "pending",
	side: "additions",
	threadId: "thread-1",
	replyToId: null,
	suggestion: null,
	suggestionBaseCode: null,
	remoteUrl: null,
	resolved: false,
	outdated: false,
	createdAt: 1_700_000_100_000,
	updatedAt: 1_700_000_100_000,
});

describe("PR-07 PrTab", () => {
	it("shows Mark ready and no Merge button for a draft, and lists branch commits", async () => {
		const { test: harness, workspace } = await seedTab(pullRequest({ state: "draft" }));
		await renderTab(harness, workspace);

		expect(await screen.findByRole("button", { name: "Mark ready" })).toBeTruthy();
		expect(await screen.findByText("Add the first commit")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Squash and merge" })).toBeNull();
	});

	it("opens the pull request where 'Open pull requests in' says from its number", async () => {
		const { test: harness, workspace } = await seedTab(pullRequest());
		await harness.container.services.settings.start();
		const set = await harness.container.services.settings.set(
			"pull_request_open_target",
			"graphite",
		);
		if (!set.ok) throw new Error(set.error.message);
		const openUrl = vi
			.spyOn(harness.container.actions.app, "openUrl")
			.mockResolvedValue(ok(undefined));
		await renderTab(harness, workspace);

		fireEvent.click(await screen.findByRole("link", { name: "#12" }));

		await waitFor(() =>
			expect(openUrl).toHaveBeenCalledWith("https://app.graphite.com/github/pr/me/project/12"),
		);
	});

	it("offers Open in, Copy link and Copy number on the number's right-click menu", async () => {
		const { test: harness, workspace } = await seedTab(pullRequest());
		const opened = vi.spyOn(harness.memory.platform.opener, "openUrl");
		await renderTab(harness, workspace);
		const link = await screen.findByRole("link", { name: "#12" });

		fireEvent.contextMenu(link);
		expect(
			(await screen.findAllByRole("menuitem")).map((item) => item.textContent?.trim()),
		).toEqual([
			expect.stringContaining("Open in GitHub"),
			"Open in Linear",
			"Open in Graphite",
			"Copy link",
			"Copy number",
		]);
		fireEvent.click(screen.getByRole("menuitem", { name: "Open in Linear" }));
		await waitFor(() =>
			expect(opened).toHaveBeenCalledWith("https://linear.review/me/project/pull/12"),
		);

		fireEvent.contextMenu(link);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
		await waitFor(() =>
			expect(harness.memory.controls.clipboardText).toBe("https://github.com/me/project/pull/12"),
		);

		fireEvent.contextMenu(link);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy number" }));
		await waitFor(() => expect(harness.memory.controls.clipboardText).toBe("12"));
	});

	it("opens the Comment tab for a comment chosen in the activity list", async () => {
		const { test: harness, workspace } = await seedTab(pullRequest());
		harness.container.services.review.store.setState((state) => ({
			...state,
			byWorkspace: { ...state.byWorkspace, [workspace.id]: [githubComment(workspace.id)] },
		}));
		const router = await renderTab(harness, workspace);

		fireEvent.click(await screen.findByText("Rename this function"));

		await waitFor(() =>
			expect(router.state.location.search).toMatchObject({
				tab: "comment",
				commentId: "comment-1",
			}),
		);
	});
});
