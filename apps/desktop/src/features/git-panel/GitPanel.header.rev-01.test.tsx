/**
 * @feature REV-01 Git panel header
 * Owns: tests of the Git panel header over the real container: the polled git state and the pull request
 * state go through the real `useGitState` and `computeGitHeader`, and the header button and the Cmd+Shift+Y key
 * pressed into the root dispatcher reach the same action.
 * Behaviour: ui-map.md 3.6 (header status and main action).
 * Test first: with two uncommitted files the header reads "Uncommitted changes" and the main action is
 * "Commit and push".
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
import type { ChangesSnapshot } from "../../core/git/status.ts";
import type { PullRequest } from "../../core/model.ts";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { GitPanel } from "./GitPanel.tsx";

afterEach(cleanup);

const snapshot = (overrides: Partial<ChangesSnapshot> = {}): ChangesSnapshot => ({
	depth: "full",
	branch: "feat",
	mergeBase: "abc123",
	mergeBaseError: null,
	files: [],
	conflictedPaths: [],
	untrackedTruncated: false,
	uncommittedFiles: 2,
	changedFiles: 2,
	operation: "none",
	commits: [],
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
	behindTarget: 0,
	...overrides,
});

const OPEN_PULL_REQUEST: PullRequest = {
	number: 1,
	url: "https://example.test/pull/1",
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
};

/**
 * Mounts the panel for a seeded workspace whose polled git state is `value`. Conductor offers
 * Commit and push once a pull request is open; before that the header offers Create PR. Most tests
 * here are about Commit and push, so the branch has an open one unless `pullRequest` says not.
 */
async function mountPanel(
	test: ReturnType<typeof createTestContainer>,
	value: ChangesSnapshot,
	pullRequest: PullRequest | null = OPEN_PULL_REQUEST,
) {
	const workspace = await seedWorkspace(test.container);
	test.container.services.git.store.setState({
		byWorkspace: { [workspace.id]: { snapshot: value, error: null, refreshedAt: 1 } },
	});
	test.container.services.github.store.setState({
		byWorkspace: {
			[workspace.id]: {
				pullRequest,
				unavailable: pullRequest === null ? "no_pr" : "none",
				fetchedAt: 1,
			},
		},
	});
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
	return workspace;
}

describe("REV-01 git panel header over the real container", () => {
	it("reads Uncommitted changes and offers Commit and push for two uncommitted files", async () => {
		const test = createTestContainer();
		try {
			await mountPanel(test, snapshot());

			expect((await screen.findAllByText("Uncommitted changes")).length).toBeGreaterThan(0);
			expect(screen.getByRole("button", { name: "Commit and push" })).toBeTruthy();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("asks the agent to commit and push when the header button is pressed", async () => {
		const test = createTestContainer();
		try {
			const commitAndPush = vi
				.spyOn(test.container.actions.git, "commitAndPush")
				.mockResolvedValue(ok(undefined));
			const workspace = await mountPanel(test, snapshot());

			fireEvent.click(await screen.findByRole("button", { name: "Commit and push" }));

			await waitFor(() => expect(commitAndPush).toHaveBeenCalledWith(workspace.id));
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("reaches the same action when Cmd+Shift+Y is pressed into the root dispatcher", async () => {
		const test = createTestContainer();
		try {
			const commitAndPush = vi
				.spyOn(test.container.actions.git, "commitAndPush")
				.mockResolvedValue(ok(undefined));
			const workspace = await mountPanel(test, snapshot());
			await screen.findByRole("button", { name: "Commit and push" });

			fireEvent.keyDown(document.body, { key: "y", metaKey: true, shiftKey: true });

			await waitFor(() => expect(commitAndPush).toHaveBeenCalledWith(workspace.id));
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("offers no Commit and push when the working tree is clean", async () => {
		const test = createTestContainer();
		try {
			const commitAndPush = vi
				.spyOn(test.container.actions.git, "commitAndPush")
				.mockResolvedValue(ok(undefined));
			await mountPanel(test, snapshot({ uncommittedFiles: 0, changedFiles: 0 }));
			await screen.findByRole("tablist");

			expect(screen.queryByRole("button", { name: "Commit and push" })).toBeNull();
			fireEvent.keyDown(document.body, { key: "y", metaKey: true, shiftKey: true });
			await Promise.resolve();
			expect(commitAndPush).not.toHaveBeenCalled();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("shows an empty header on a GitHub branch with no pull request and no changes", async () => {
		const test = createTestContainer();
		try {
			await mountPanel(
				test,
				snapshot({
					uncommittedFiles: 2,
					changedFiles: 0,
					sync: { ahead: 3, behind: 0, rewritten: false, hasUpstream: true },
				}),
				null,
			);
			await screen.findByRole("tablist");

			expect(screen.queryByText("Uncommitted changes")).toBeNull();
			expect(screen.queryByText("No changes")).toBeNull();
			expect(screen.queryByText(/Ahead by/)).toBeNull();
			expect(screen.queryByRole("button", { name: "PR status details" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Commit and push" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("offers Create PR as an outlined button whose menu creates a draft or opens GitHub", async () => {
		const test = createTestContainer();
		try {
			const create = vi
				.spyOn(test.container.actions.pullRequests, "create")
				.mockResolvedValue(ok(undefined));
			const openOnGithub = vi
				.spyOn(test.container.actions.pullRequests, "openOnGithub")
				.mockResolvedValue(ok(undefined));
			const workspace = await mountPanel(test, snapshot({ changedFiles: 2 }), null);

			const button = await screen.findByRole("button", { name: "Create PR" });
			expect(button.getAttribute("data-variant")).toBe("outline");
			expect(screen.queryByRole("button", { name: "PR status details" })).toBeNull();

			fireEvent.click(button);
			await waitFor(() => expect(create).toHaveBeenCalledWith(workspace.id, { draft: false }));

			fireEvent.click(screen.getByRole("button", { name: "More ways to create a PR" }));
			fireEvent.click(await screen.findByRole("menuitem", { name: "Create draft PR" }));
			await waitFor(() => expect(create).toHaveBeenCalledWith(workspace.id, { draft: true }));

			fireEvent.click(screen.getByRole("button", { name: "More ways to create a PR" }));
			fireEvent.click(await screen.findByRole("menuitem", { name: "Create PR manually" }));
			await waitFor(() => expect(openOnGithub).toHaveBeenCalledWith(workspace.id));
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});
