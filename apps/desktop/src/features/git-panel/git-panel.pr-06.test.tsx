/**
 * @feature PR-06 Merge, auto-merge, ready for review, approve
 * Owns: the test that Cmd+Shift+M, pressed into the mounted root dispatcher, merges the pull
 * request the git panel shows, and only while its header offers the merge.
 * Behaviour: ui-map.md 5.4 (Cmd+Shift+M merge PR) and 3.6 (the header's merge action).
 * Test first: Cmd+Shift+M on a pull request that is ready to merge calls pullRequests.merge.
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
	viewerDidAuthor: true,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
	...overrides,
});

/** A workspace with a clean, pushed branch and the given pull request in the GitHub store. */
async function seedPanel(pr: PullRequest): Promise<{ test: TestContainer; workspace: Workspace }> {
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
		byWorkspace: { [workspace.id]: { pullRequest: pr, unavailable: "none", fetchedAt: 1 } },
	});
	return { test, workspace };
}

/** Mounts the panel under the root dispatcher, the way the workspace screen does. */
async function renderPanel(harness: TestContainer, workspace: Workspace): Promise<void> {
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
		<ServicesProvider container={harness.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
}

const pressMergeShortcut = (): void => {
	fireEvent.keyDown(document.body, { key: "m", metaKey: true, shiftKey: true });
};

describe("PR-06 Cmd+Shift+M in the git panel", () => {
	it("merges the pull request when the header offers the merge", async () => {
		const { test: harness, workspace } = await seedPanel(pullRequest());
		const merge = vi
			.spyOn(harness.container.actions.pullRequests, "merge")
			.mockResolvedValue(ok(undefined));
		await renderPanel(harness, workspace);
		await screen.findByRole("button", { name: "Merge" });

		pressMergeShortcut();

		await waitFor(() => expect(merge).toHaveBeenCalledWith(workspace.id));
		expect(merge).toHaveBeenCalledTimes(1);
	});

	it("does not merge while the header offers no merge", async () => {
		const pending = pullRequest({
			checks: [
				{
					name: "build",
					state: "running",
					url: null,
					startedAt: null,
					completedAt: null,
					required: true,
				},
			],
		});
		const { test: harness, workspace } = await seedPanel(pending);
		const merge = vi
			.spyOn(harness.container.actions.pullRequests, "merge")
			.mockResolvedValue(ok(undefined));
		await renderPanel(harness, workspace);
		expect((await screen.findAllByText("1 check pending...")).length).toBeGreaterThan(0);

		pressMergeShortcut();
		await Promise.resolve();

		expect(merge).not.toHaveBeenCalled();
	});
});
