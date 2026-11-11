/**
 * @feature PR-04 PR-06 REV-01 REV-06 The palette's git panel commands
 * Owns: tests that Show checks, Show changes, Show all files and Mark ready for review reach the
 * panel's tab and pull request actions, over the real container the panel runs on.
 * Behaviour: ui-map.md 5.1 (the palette's Workspace actions; Conductor sets the git panel's tab and
 * diff scope, renderApp @11369192, and marks a draft pull request ready, @11370438).
 * Test first: running "pr.showChecks" selects the Checks tab.
 */
import { ok } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, runCommandHandlers } from "../../app/command-dispatcher.ts";
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
	clearCommandHandlers();
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

/** Mounts the panel over the real container; the screen handlers register into the default registry. */
async function renderPanel(harness: TestContainer, workspace: Workspace): Promise<void> {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <GitPanel workspaceId={workspace.id} />,
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

const activeTab = (name: RegExp): string | null =>
	screen.getByRole("tab", { name }).getAttribute("data-state");

describe("git panel commands from the palette", () => {
	it("selects the Checks tab for Show checks", async () => {
		const { test: harness, workspace } = await seedPanel(pullRequest());
		await renderPanel(harness, workspace);
		await screen.findByRole("tab", { name: /Checks/ });

		act(() => expect(runCommandHandlers("pr.showChecks")).toBe(true));

		expect(activeTab(/Checks/)).toBe("active");
	});

	it("selects the Changes tab for Show changes", async () => {
		const { test: harness, workspace } = await seedPanel(pullRequest());
		await renderPanel(harness, workspace);
		await screen.findByRole("tab", { name: /Changes/ });

		act(() => expect(runCommandHandlers("review.showChanges")).toBe(true));

		expect(activeTab(/Changes/)).toBe("active");
	});

	it("selects the All files tab for Show all files", async () => {
		const { test: harness, workspace } = await seedPanel(pullRequest());
		await renderPanel(harness, workspace);
		await screen.findByRole("tab", { name: "All files" });

		act(() => expect(runCommandHandlers("review.showAllFiles")).toBe(true));

		expect(activeTab(/^All files/)).toBe("active");
	});

	it("marks a draft pull request ready for review", async () => {
		const { test: harness, workspace } = await seedPanel(pullRequest({ state: "draft" }));
		const markReady = vi
			.spyOn(harness.container.actions.pullRequests, "markReady")
			.mockResolvedValue(ok(undefined));
		await renderPanel(harness, workspace);
		await screen.findByRole("button", { name: /Ready for review/ });

		act(() => expect(runCommandHandlers("pr.markReady")).toBe(true));

		await waitFor(() => expect(markReady).toHaveBeenCalledWith(workspace.id));
	});
});
