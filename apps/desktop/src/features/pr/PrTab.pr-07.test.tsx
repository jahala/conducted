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

async function renderTab(harness: TestContainer, workspace: Workspace): Promise<void> {
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
}

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
});
