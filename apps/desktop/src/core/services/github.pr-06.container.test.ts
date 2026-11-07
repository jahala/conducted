// @vitest-environment node
/**
 * @feature PR-06 Merge, auto-merge, ready for review, approve
 * @feature REV-04 Sync review comments with GitHub
 * @feature GIT-08 Change the target branch
 * Owns: the composition-root tests that a pull request the poll found by its branch, which the
 * workspace never linked, is the one the write actions and the review comment sync act on.
 * Behaviour: services-map.md 3.7.5 (`gh pr ready <n>`), 3.7.4 (review threads by PR number); an
 * agent opens most pull requests, so the poll's answer is the only place their number lives
 * (Conductor reads it from `workspacePrInfo`, services-map.md 2426).
 * Test first: marking ready a pull request found by its branch runs gh pr ready with its number.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellCommand } from "../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import type { PullRequest } from "../model.ts";

const remoteUrl = "git@github.com:octo/repo.git";

const found: PullRequest = {
	number: 231,
	url: "https://github.com/octo/repo/pull/231",
	title: "Keep the requested page after sign-in",
	body: "",
	state: "draft",
	mergeable: "mergeable",
	reviewDecision: "changes_requested",
	checks: [],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "sam",
	viewerDidAuthor: true,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 1,
};

const threads = JSON.stringify({
	data: {
		rateLimit: { cost: 1 },
		repository: {
			pullRequest: {
				reviewThreads: {
					pageInfo: { hasNextPage: false, endCursor: null },
					nodes: [
						{
							id: "PRRT_1",
							isOutdated: false,
							isResolved: false,
							path: "src/a.ts",
							line: 4,
							startLine: null,
							originalLine: 4,
							originalStartLine: null,
							startDiffSide: null,
							diffSide: "RIGHT",
							comments: {
								pageInfo: { hasNextPage: false, endCursor: null },
								nodes: [
									{
										id: "PRRC_1",
										databaseId: 101,
										body: "Please rename this.",
										diffHunk: null,
										url: null,
										createdAt: "2026-11-05T09:00:00Z",
										updatedAt: "2026-11-05T09:00:00Z",
										lastEditedAt: null,
										author: { login: "lee", avatarUrl: "" },
										replyTo: null,
									},
								],
							},
						},
					],
				},
			},
		},
	},
});

const noComments = JSON.stringify({
	data: {
		repository: {
			pullRequest: { comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
		},
	},
});

/** A workspace whose pull request the poll found by branch; every command it runs is kept. */
async function seedFoundByBranch(): Promise<{
	harness: TestContainer;
	workspaceId: WorkspaceId;
	ran: ShellCommand[];
}> {
	const harness = createTestContainer();
	const repo = await seedRepo(harness.container, { rootPath: "/code/atlas", remoteUrl });
	const loaded = await harness.container.services.repo.loadConfig(repo.id);
	if (!loaded.ok) throw new Error(loaded.error.message);
	const workspace = await seedWorkspace(harness.container, {
		repoId: repo.id,
		path: "/code/workspaces/arbor",
		branch: "sam/fix-login-redirect",
	});
	const ran: ShellCommand[] = [];
	harness.memory.controls.scriptShell((command) => {
		ran.push(command);
		if (command.program === "git" && command.args.includes("get-url")) {
			return ok({ exitCode: 0, stdout: `${remoteUrl}\n`, stderr: "" });
		}
		const query = command.args.find((arg) => arg.startsWith("query=")) ?? "";
		if (command.program === "gh" && query.includes("reviewThreads")) {
			return ok({ exitCode: 0, stdout: threads, stderr: "" });
		}
		if (command.program === "gh" && query.includes("comments(")) {
			return ok({ exitCode: 0, stdout: noComments, stderr: "" });
		}
		if (command.program === "gh" && command.args.slice(0, 2).join(" ") === "pr view") {
			return ok({ exitCode: 0, stdout: "OPEN\n", stderr: "" });
		}
		return ok({ exitCode: 0, stdout: "", stderr: "" });
	});
	// What the branch poll stores: the pull request, with no number linked on the workspace.
	harness.container.services.github.store.setState((state) => ({
		...state,
		byWorkspace: {
			...state.byWorkspace,
			[workspace.id]: { pullRequest: found, unavailable: "none", fetchedAt: 1 },
		},
	}));
	expect(
		harness.container.services.workspace.store.getState().workspacesById[workspace.id]?.prNumber,
	).toBeNull();
	return { harness, workspaceId: workspace.id, ran };
}

describe("a pull request found by its branch", () => {
	it("marking ready a pull request found by its branch runs gh pr ready with its number", async () => {
		const { harness, workspaceId, ran } = await seedFoundByBranch();
		try {
			const marked = await harness.container.actions.pullRequests.markReady(workspaceId);

			expect(marked).toEqual(ok(undefined));
			const ready = ran.find((command) => command.program === "gh" && command.args[1] === "ready");
			expect(ready?.args.slice(0, 3)).toEqual(["pr", "ready", "231"]);
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});

	it("syncs the review comments of a pull request found by its branch", async () => {
		const { harness, workspaceId } = await seedFoundByBranch();
		try {
			const synced = await harness.container.services.review.syncFromGithub(workspaceId);

			expect(synced).toEqual(ok(undefined));
			const comments = harness.container.services.review.store.getState().byWorkspace[workspaceId];
			expect(comments?.map((comment) => comment.body)).toEqual(["Please rename this."]);
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});

	it("moves the base of a pull request found by its branch to the new target", async () => {
		const { harness, workspaceId, ran } = await seedFoundByBranch();
		try {
			const moved = await harness.container.services.github.moveOpenPullRequestBase(
				workspaceId,
				"release",
			);

			expect(moved).toEqual(ok(true));
			const edit = ran.find((command) => command.program === "gh" && command.args[1] === "edit");
			expect(edit?.args).toEqual(["pr", "edit", "231", "--base", "release"]);
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});
});
