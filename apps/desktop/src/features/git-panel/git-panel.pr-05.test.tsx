/**
 * @feature PR-05 "Fix errors": send failing checks to the agent
 * Owns: the test that Cmd+Shift+X, pressed into the mounted root dispatcher, sends the failing
 * checks to the agent, and only while the git header offers Fix errors.
 * Behaviour: ui-map.md 5.4 (Cmd+Shift+X fix errors) and 3.6 (the header's Fix errors action).
 * Test first: Cmd+Shift+X on a pull request with a failed check calls pullRequests.fixErrors.
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
import type { CheckRun, PullRequest, Workspace } from "../../core/model.ts";
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

const check = (state: CheckRun["state"]): CheckRun => ({
	name: "build",
	state,
	url: "https://github.com/me/project/actions/runs/1/job/2",
	startedAt: null,
	completedAt: null,
	required: true,
});

const pullRequest = (checkState: CheckRun["state"]): PullRequest => ({
	number: 12,
	url: "https://github.com/me/project/pull/12",
	title: "A change",
	body: "",
	state: "open",
	mergeable: "mergeable",
	reviewDecision: null,
	checks: [check(checkState)],
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

const pressFixErrorsShortcut = (): void => {
	fireEvent.keyDown(document.body, { key: "x", metaKey: true, shiftKey: true });
};

describe("PR-05 Cmd+Shift+X in the git panel", () => {
	it("sends the failing checks when the header offers Fix errors", async () => {
		const { test: harness, workspace } = await seedPanel(pullRequest("failure"));
		const fixErrors = vi
			.spyOn(harness.container.services.github, "fixErrors")
			.mockResolvedValue(ok(undefined));
		await renderPanel(harness, workspace);
		await screen.findByRole("button", { name: /Fix errors/ });

		pressFixErrorsShortcut();

		await waitFor(() => expect(fixErrors).toHaveBeenCalledWith(workspace.id));
		expect(fixErrors).toHaveBeenCalledTimes(1);
	});

	it("does not send anything while a check is still running", async () => {
		const { test: harness, workspace } = await seedPanel(pullRequest("running"));
		const fixErrors = vi
			.spyOn(harness.container.services.github, "fixErrors")
			.mockResolvedValue(ok(undefined));
		await renderPanel(harness, workspace);
		expect((await screen.findAllByText("1 check pending...")).length).toBeGreaterThan(0);

		pressFixErrorsShortcut();
		await Promise.resolve();

		expect(fixErrors).not.toHaveBeenCalled();
	});
});
