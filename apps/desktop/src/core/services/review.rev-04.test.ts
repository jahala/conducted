/**
 * @feature REV-04 Sync review comments with GitHub
 * Tests the mapping from GitHub review threads and general comments into diff comments, the
 * sync's edited text and its per-scope delete, and resolving a thread on GitHub.
 * Behaviour: services-map.md 5A.7.3, 3.7.4 and 2.3.5.
 * Test first: a failed general-comment fetch keeps thread comments that vanished from GitHub.
 */
import { appError, type CommentId, err, ok, type WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import type {
	GithubGeneralComment,
	GithubReviewThread,
	GithubReviewThreadComment,
} from "./github.ts";
import {
	diffCommentsFromGithubGeneral,
	diffCommentsFromGithubThreads,
	suggestionFromGithubBody,
} from "./review.ts";

const workspaceId = "ws-rev-04" as WorkspaceId;

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
	vi.restoreAllMocks();
});

function comment(overrides: Partial<GithubReviewThreadComment> = {}): GithubReviewThreadComment {
	return {
		id: "PRRC_1",
		databaseId: 101,
		body: "The first name is unused.",
		url: "https://github.com/o/r/pull/12#discussion_r101",
		authorLogin: "octocat",
		authorAvatarUrl: "https://avatars.example/octocat",
		createdAt: 1_000,
		updatedAt: 2_000,
		lastEditedAt: null,
		diffHunk: "@@ -1,5 +1,5 @@",
		replyToId: null,
		replyToDatabaseId: null,
		...overrides,
	};
}

function thread(overrides: Partial<GithubReviewThread> = {}): GithubReviewThread {
	return {
		id: "PRT_1",
		isOutdated: true,
		isResolved: true,
		path: "src/a.ts",
		line: 5,
		startLine: 3,
		originalLine: 5,
		originalStartLine: 3,
		startDiffSide: "RIGHT",
		diffSide: "LEFT",
		comments: [comment()],
		commentsHasNextPage: false,
		commentsEndCursor: null,
		...overrides,
	};
}

function generalComment(overrides: Partial<GithubGeneralComment> = {}): GithubGeneralComment {
	return {
		id: "PRRC_200",
		databaseId: 200,
		body: "Thanks for the change.",
		url: "https://github.com/o/r/pull/12#issuecomment-200",
		authorLogin: "reviewer",
		authorAvatarUrl: null,
		createdAt: 1_500,
		updatedAt: 1_500,
		lastEditedAt: null,
		...overrides,
	};
}

describe("REV-04 GitHub comment mapping", () => {
	it("maps a thread's ids, range, side, outdated, resolved and suggestion", () => {
		const [mapped] = diffCommentsFromGithubThreads(workspaceId, [
			thread({
				comments: [
					comment({
						body: "Use the new name.\n```suggestion\nconst displayName = 2;\n```",
					}),
				],
			}),
		]);

		expect(mapped).toMatchObject({
			id: "github-PRT_1-101",
			workspaceId,
			filePath: "src/a.ts",
			line: 3,
			endLine: 5,
			side: "deletions",
			threadId: "PRT_1",
			replyToId: null,
			suggestion: "const displayName = 2;",
			remoteUrl: "https://github.com/o/r/pull/12#discussion_r101",
			author: {
				kind: "github",
				name: "octocat",
				avatarUrl: "https://avatars.example/octocat",
			},
			resolved: true,
			outdated: true,
		});
	});

	it("links a reply to its parent comment's local id", () => {
		const [mapped] = diffCommentsFromGithubThreads(workspaceId, [
			thread({
				comments: [
					comment({
						id: "PRRC_2",
						databaseId: 102,
						replyToId: "PRRC_1",
						replyToDatabaseId: 101,
					}),
				],
			}),
		]);

		expect(mapped?.replyToId).toBe("github-PRT_1-101");
	});

	it("brings in general comments with no file", () => {
		const [mapped] = diffCommentsFromGithubGeneral(workspaceId, [generalComment()]);

		expect(mapped).toMatchObject({
			id: "github-general-200",
			filePath: null,
			line: null,
			threadId: null,
			author: { kind: "github", name: "reviewer", avatarUrl: null },
			body: "Thanks for the change.",
		});
	});

	it("reads only the fenced suggestion as the replacement", () => {
		expect(suggestionFromGithubBody("Prose\n```suggestion\nconst a = 1;\n```\nMore prose")).toBe(
			"const a = 1;",
		);
		expect(suggestionFromGithubBody("No suggestion here.")).toBeNull();
	});
});

describe("REV-04 GitHub comment sync over the real container", () => {
	it("shows an edited GitHub comment's new text after the next sync", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
		const threads = vi
			.spyOn(test.container.services.github, "readReviewThreads")
			.mockResolvedValue(ok([thread({ comments: [comment({ body: "Old text" })] })]));

		expect(await review.syncFromGithub(workspace.id)).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]?.map((entry) => entry.body)).toEqual([
			"Old text",
		]);

		threads.mockResolvedValue(
			ok([thread({ comments: [comment({ body: "New text", updatedAt: 3_000 })] })]),
		);
		expect(await review.syncFromGithub(workspace.id)).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]?.map((entry) => entry.body)).toEqual([
			"New text",
		]);
	});

	it("deletes vanished comments only in the scope that answered", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		const threads = vi.spyOn(test.container.services.github, "readReviewThreads");
		const general = vi.spyOn(test.container.services.github, "readGeneralComments");

		threads.mockResolvedValue(ok([thread()]));
		general.mockResolvedValue(ok([generalComment()]));
		expect(await review.syncFromGithub(workspace.id)).toEqual(ok(undefined));

		// Threads answered with nothing vanished; the general fetch failed, so its rows stay.
		threads.mockResolvedValue(ok([]));
		general.mockResolvedValue(err(appError("github_failed", "GitHub is offline.")));
		const first = await review.syncFromGithub(workspace.id);
		expect(first.ok).toBe(false);
		expect(review.store.getState().byWorkspace[workspace.id]?.map((entry) => entry.id)).toEqual([
			"github-general-200",
		]);

		// Restore both, then let the thread fetch fail and general answer with nothing vanished.
		threads.mockResolvedValue(ok([thread()]));
		general.mockResolvedValue(ok([generalComment()]));
		expect(await review.syncFromGithub(workspace.id)).toEqual(ok(undefined));
		threads.mockResolvedValue(err(appError("github_failed", "GitHub is offline.")));
		general.mockResolvedValue(ok([]));
		const second = await review.syncFromGithub(workspace.id);
		expect(second.ok).toBe(false);
		expect(review.store.getState().byWorkspace[workspace.id]?.map((entry) => entry.id)).toEqual([
			"github-PRT_1-101",
		]);
	});

	it("resolves a thread on GitHub before marking its local rows resolved", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
		vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(
			ok([thread({ isResolved: false })]),
		);
		expect(await review.syncFromGithub(workspace.id)).toEqual(ok(undefined));
		const resolve = vi
			.spyOn(test.container.services.github, "resolveReviewThread")
			.mockResolvedValue(ok(undefined));

		const result = await review.resolveOnGithub("github-PRT_1-101" as CommentId);

		expect(result).toEqual(ok(undefined));
		expect(resolve).toHaveBeenCalledWith(workspace.id, "PRT_1");
		expect(review.store.getState().byWorkspace[workspace.id]?.[0]?.resolved).toBe(true);
	});

	it("keeps the local rows unresolved when GitHub refuses the resolve", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
		vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(
			ok([thread({ isResolved: false })]),
		);
		expect(await review.syncFromGithub(workspace.id)).toEqual(ok(undefined));
		vi.spyOn(test.container.services.github, "resolveReviewThread").mockResolvedValue(
			err(appError("github_failed", "GitHub refused.")),
		);

		const result = await review.resolveOnGithub("github-PRT_1-101" as CommentId);

		expect(result.ok).toBe(false);
		expect(review.store.getState().byWorkspace[workspace.id]?.[0]?.resolved).toBe(false);
	});
});

describe("REV-04 a failed sync and GitHub thread resolves", () => {
	it("keeps a failed sync in syncErrors until a sync answers", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
		const threads = vi
			.spyOn(test.container.services.github, "readReviewThreads")
			.mockResolvedValue(err(appError("github_failed", "gh is not signed in.")));

		const failed = await review.syncFromGithub(workspace.id);

		expect(failed).toEqual(err(appError("github_failed", "gh is not signed in.")));
		expect(review.store.getState().syncErrors[workspace.id]).toEqual({
			code: "github_failed",
			message: "gh is not signed in.",
		});

		threads.mockResolvedValue(ok([thread()]));
		expect(await review.syncFromGithub(workspace.id)).toEqual(ok(undefined));
		expect(review.store.getState().syncErrors[workspace.id]).toBeUndefined();
	});

	it("returns the real failure when the other list is a normal skip", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(
			err(appError("github_pr_missing", "No pull request.")),
		);
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(
			err(appError("github_failed", "GitHub timed out.")),
		);

		const result = await review.syncFromGithub(workspace.id);

		expect(result).toEqual(err(appError("github_failed", "GitHub timed out.")));
		expect(review.store.getState().syncErrors[workspace.id]?.code).toBe("github_failed");
	});

	it("resolves a GitHub thread on GitHub when the comment action resolves it", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
		vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(
			ok([thread({ isResolved: false })]),
		);
		expect(await test.container.services.review.syncFromGithub(workspace.id)).toEqual(
			ok(undefined),
		);
		const resolve = vi
			.spyOn(test.container.services.github, "resolveReviewThread")
			.mockResolvedValue(ok(undefined));

		const result = await test.container.actions.comments.setResolved(
			"github-PRT_1-101" as CommentId,
			true,
		);

		expect(result).toEqual(ok(undefined));
		expect(resolve).toHaveBeenCalledWith(workspace.id, "PRT_1");
		expect(
			test.container.services.review.store.getState().byWorkspace[workspace.id]?.[0]?.resolved,
		).toBe(true);
	});

	it("refuses to unresolve a GitHub thread here and keeps the row resolved", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
		vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(
			ok([thread({ isResolved: true })]),
		);
		expect(await test.container.services.review.syncFromGithub(workspace.id)).toEqual(
			ok(undefined),
		);

		const result = await test.container.actions.comments.setResolved(
			"github-PRT_1-101" as CommentId,
			false,
		);

		expect(result.ok).toBe(false);
		expect(result.ok ? null : result.error.code).toBe("review_github_unresolve");
		expect(
			test.container.services.review.store.getState().byWorkspace[workspace.id]?.[0]?.resolved,
		).toBe(true);
	});
});
