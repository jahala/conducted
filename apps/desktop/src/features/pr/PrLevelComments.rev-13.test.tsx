/**
 * @feature REV-13 Pull request comments without a file
 * Owns: tests of the PR-level comment list and of its place in the PR tab, over the real container.
 * Behaviour: services-map.md 3.7.4 and 5A.7.3; ui-map.md 3.2 (the PR tab).
 * Test first: three comments, one with a file path, show two entries, and the file one is absent.
 */
import type { WorkspaceId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import type { PrActivityEntry, PullRequest } from "../../core/model.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { PrLevelComments } from "./PrLevelComments.tsx";
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

type CommentEntry = Extract<PrActivityEntry, { kind: "comment" }>;

const comment = (
	id: string,
	body: string,
	overrides: Partial<CommentEntry> = {},
): CommentEntry => ({
	kind: "comment",
	id,
	at: 1_000,
	authorLogin: "octocat",
	authorAvatarUrl: null,
	body,
	filePath: null,
	line: null,
	commentId: id,
	...overrides,
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

async function renderTab(harness: TestContainer, workspaceId: WorkspaceId) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<CommandDispatcher>
				<PrTab workspaceId={workspaceId} />
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

describe("REV-13 pull request comments without a file", () => {
	it("shows only the comments with no file, not the one on a file", () => {
		render(
			<PrLevelComments
				entries={[
					comment("first", "First comment"),
					comment("second", "Second comment"),
					comment("file", "A file comment", { filePath: "src/app.ts", line: 4 }),
				]}
			/>,
		);

		const region = screen.getByRole("region", { name: "Comments" });
		expect(within(region).getAllByRole("listitem")).toHaveLength(2);
		expect(within(region).getByText("First comment")).toBeTruthy();
		expect(within(region).getByText("Second comment")).toBeTruthy();
		expect(within(region).queryByText("A file comment")).toBeNull();
	});

	it("shows the author's avatar, and a letter when there is none", () => {
		render(
			<PrLevelComments
				entries={[
					comment("with-avatar", "Has an avatar", {
						authorAvatarUrl: "https://avatars.example/octocat.png",
					}),
					comment("without-avatar", "Has no avatar", {
						authorLogin: "hubot",
					}),
				]}
			/>,
		);

		const rows = within(screen.getByRole("region", { name: "Comments" })).getAllByRole("listitem");
		expect(rows[0]?.querySelector("img")?.getAttribute("src")).toBe(
			"https://avatars.example/octocat.png",
		);
		expect(rows[1]?.querySelector("img")).toBeNull();
		expect(within(rows[1] as HTMLElement).getByText("H")).toBeTruthy();
	});

	it("falls back to the letter when the avatar fails to load", () => {
		render(
			<PrLevelComments
				entries={[
					comment("broken", "An avatar that fails", {
						authorAvatarUrl: "https://avatars.example/octocat.png",
					}),
				]}
			/>,
		);

		const image = document.querySelector("img");
		if (image === null) throw new Error("the avatar image was not rendered");
		fireEvent.error(image);

		expect(document.querySelector("img")).toBeNull();
		expect(screen.getByText("O")).toBeTruthy();
	});

	it("hides the section when the pull request has no comments of its own", () => {
		render(
			<PrLevelComments
				entries={[comment("file", "A file comment", { filePath: "src/app.ts", line: 4 })]}
			/>,
		);

		expect(screen.queryByRole("region", { name: "Comments" })).toBeNull();
	});

	it("shows a pull request comment in the PR tab, and not in Activity as well", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, { repoId: repo.id, branch: "feat" });
		vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(ok([]));
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(
			ok([
				{
					id: "IC_200",
					databaseId: 200,
					body: "A pull request comment",
					url: "https://github.com/me/project/pull/12#issuecomment-200",
					authorLogin: "octocat",
					authorAvatarUrl: "https://avatars.example/octocat.png",
					createdAt: 1_000,
					updatedAt: 1_000,
					lastEditedAt: null,
				},
			]),
		);
		const synced = await test.container.services.review.syncFromGithub(workspace.id);
		if (!synced.ok) throw new Error(synced.error.message);

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
			byWorkspace: {
				[workspace.id]: { pullRequest: pullRequest(), unavailable: "none", fetchedAt: 1 },
			},
		});

		await renderTab(test, workspace.id);

		const comments = await screen.findByRole("region", { name: "Comments" });
		expect(within(comments).getByText("A pull request comment")).toBeTruthy();
		const activity = screen.getByRole("region", { name: "Activity" });
		expect(within(activity).queryByText("A pull request comment")).toBeNull();
	});
});
