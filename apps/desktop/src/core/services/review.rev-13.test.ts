/**
 * @feature REV-13 Pull request comments without a file
 * Tests that a general GitHub comment is stored on the pull request itself and keeps its author's
 * avatar through the review service.
 * Behaviour: services-map.md 3.7.4 and 5A.7.3.
 * Test first: a synced general comment has a null file path, location pull_request and its avatar.
 */
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import type { GithubGeneralComment } from "./github.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
	vi.restoreAllMocks();
});

const generalComment: GithubGeneralComment = {
	id: "IC_200",
	databaseId: 200,
	body: "The pull request needs a description.",
	url: "https://github.com/o/r/pull/12#issuecomment-200",
	authorLogin: "octocat",
	authorAvatarUrl: "https://avatars.example/octocat.png",
	createdAt: 1_500,
	updatedAt: 1_500,
	lastEditedAt: null,
};

describe("REV-13 pull request comments without a file", () => {
	it("stores a synced general comment on the pull request itself with its author's avatar", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(ok([]));
		vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(
			ok([generalComment]),
		);

		const synced = await review.syncFromGithub(workspace.id);
		if (!synced.ok) throw new Error(synced.error.message);

		const stored = review.store.getState().byWorkspace[workspace.id] ?? [];
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			id: "github-general-200",
			workspaceId: workspace.id,
			filePath: null,
			line: null,
			body: "The pull request needs a description.",
			author: {
				kind: "github",
				name: "octocat",
				avatarUrl: "https://avatars.example/octocat.png",
			},
		});

		const rows = await test.database.select<{ location: string; file_path: string }>(
			"SELECT location, file_path FROM diff_comments WHERE id = $1",
			["github-general-200"],
		);
		expect(rows).toEqual([{ location: "pull_request", file_path: "" }]);
	});
});
