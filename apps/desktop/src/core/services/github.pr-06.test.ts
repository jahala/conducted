// @vitest-environment node
/**
 * @feature PR-06 Merge, auto-merge, ready for review, approve
 * Owns: tests for the pull request write actions, the pending action state and the per-repository
 * merge method cache, plus one test over the real composition root.
 * Behaviour: services-map.md 3.7.5 and 5B.1.7 (the write actions table and its dedupe), 3.16
 * (merges pinned with --match-head-commit and approvals with commit_id).
 * Test first: enabling auto-merge sends `gh pr merge --auto` pinned to the local HEAD.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { PullRequestAction } from "../model.ts";
import { GithubService, type PrWorkspaceContext } from "./github.ts";

const workspaceId = "ws-1" as WorkspaceId;

const context = (prNumber: number | null = 12): PrWorkspaceContext => ({
	workspaceId,
	workspacePath: "/wt",
	branch: "feat",
	remote: "origin",
	prNumber,
	targetBranch: "origin/main",
});

function makeService(git: FakeGitRunner, prNumber: number | null = 12): GithubService {
	return new GithubService({
		git,
		cache: {} as never,
		agent: {} as never,
		contextOf: async () => ok(context(prNumber)),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: "/tmp",
	});
}

/** The answers every write action needs before it reaches its own `gh` command. */
function defaultAnswer(command: GitCommand): Result<ShellOutput> {
	if (command.program === "git" && command.args[0] === "rev-parse") {
		return command.args[1] === "HEAD" ? gitOutput("abc123\n") : gitOutput(".git\n");
	}
	if (command.program === "gh" && command.args[0] === "api" && command.args.includes("graphql")) {
		return gitOutput("[true,true,true]\n");
	}
	if (
		command.program === "gh" &&
		command.args[0] === "pr" &&
		command.args[1] === "view" &&
		command.args.includes("headRefOid")
	) {
		return gitOutput("head-oid\n");
	}
	return gitOutput();
}

const commandArgs = (git: FakeGitRunner): string[][] =>
	git.commands.map((command) => [...command.args]);

describe("PR-06 pull request write actions", () => {
	it("marks a pull request ready with gh pr ready", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		expect(await service.markReady(workspaceId)).toEqual(ok(undefined));
		expect(commandArgs(git)).toContainEqual(["pr", "ready", "12"]);
	});

	it("enables auto-merge with a merge pinned to the local HEAD", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		expect(await service.setAutoMerge(workspaceId, true)).toEqual(ok(undefined));
		expect(commandArgs(git)).toContainEqual([
			"pr",
			"merge",
			"12",
			"--squash",
			"--auto",
			"--match-head-commit",
			"abc123",
		]);
	});

	it("disables auto-merge with gh pr merge --disable-auto", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		expect(await service.setAutoMerge(workspaceId, false)).toEqual(ok(undefined));
		expect(commandArgs(git)).toContainEqual(["pr", "merge", "12", "--disable-auto"]);
	});

	it("merges with the repository's method pinned to the local HEAD", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		expect(await service.merge(workspaceId)).toEqual(ok(undefined));
		expect(commandArgs(git)).toContainEqual([
			"pr",
			"merge",
			"12",
			"--squash",
			"--match-head-commit",
			"abc123",
		]);
	});

	it("runs one mark-ready while a second press waits on the same action", async () => {
		let release: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started: (() => void) | undefined;
		const reached = new Promise<void>((resolve) => {
			started = resolve;
		});
		const git = new FakeGitRunner(async (command) => {
			if (command.args[0] === "pr" && command.args[1] === "ready") {
				started?.();
				await blocked;
			}
			return defaultAnswer(command);
		});
		const service = makeService(git);

		const first = service.markReady(workspaceId);
		await reached;
		const second = service.markReady(workspaceId);
		release?.();

		expect(await Promise.all([first, second])).toEqual([ok(undefined), ok(undefined)]);
		expect(
			git.commands.filter(
				(command) =>
					command.program === "gh" && command.args[0] === "pr" && command.args[1] === "ready",
			),
		).toHaveLength(1);
	});

	it("approves pinned to the pull request's head commit", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		expect(await service.approve(workspaceId)).toEqual(ok(undefined));
		const approve = git.commands.find(
			(command) => command.program === "gh" && command.args[0] === "api",
		);
		expect(approve?.args).toEqual([
			"api",
			"repos/{owner}/{repo}/pulls/12/reviews",
			"-f",
			"event=APPROVE",
			"-f",
			"commit_id=head-oid",
		]);
	});

	it("edits the title and body with one gh pr edit", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		expect(await service.updateTitleAndBody(workspaceId, "New title", "New body")).toEqual(
			ok(undefined),
		);
		expect(commandArgs(git)).toContainEqual([
			"pr",
			"edit",
			"12",
			"--title",
			"New title",
			"--body",
			"New body",
		]);
	});

	it("adds and removes reviewers through gh pr edit", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		expect(await service.requestReview(workspaceId, ["octocat", "hubot", "octocat"])).toEqual(
			ok(undefined),
		);
		expect(await service.removeReviewRequest(workspaceId, "hubot")).toEqual(ok(undefined));

		expect(commandArgs(git)).toContainEqual([
			"pr",
			"edit",
			"12",
			"--add-reviewer",
			"octocat",
			"--add-reviewer",
			"hubot",
		]);
		expect(commandArgs(git)).toContainEqual(["pr", "edit", "12", "--remove-reviewer", "hubot"]);
	});

	it("refuses an empty reviewer list instead of sending gh", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		const result = await service.requestReview(workspaceId, ["   "]);

		expect(!result.ok && result.error.code).toBe("github_reviewer_missing");
		expect(git.commands).toEqual([]);
	});

	it("refuses to act when the workspace has no pull request", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git, null);

		const result = await service.markReady(workspaceId);

		expect(!result.ok && result.error.code).toBe("github_pr_missing");
		expect(git.commands).toEqual([]);
	});

	it("reports a moved head as a blocked merge, not a raw gh failure", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "gh" && command.args[0] === "pr" && command.args[1] === "merge") {
				return gitOutput("", "the head commit abc123 does not match the pull request head", 1);
			}
			return defaultAnswer(command);
		});
		const service = makeService(git);

		const result = await service.merge(workspaceId);

		expect(!result.ok && result.error.code).toBe("github_head_mismatch");
		expect(!result.ok && result.error.message).toBe(
			"Merge blocked: this workspace's code is different from the pull request's head. Pull the latest changes and try again.",
		);
	});

	it("reads the merge method once per repository and reuses it", async () => {
		const git = new FakeGitRunner(defaultAnswer);
		const service = makeService(git);

		expect(await service.merge(workspaceId)).toEqual(ok(undefined));
		expect(await service.merge(workspaceId)).toEqual(ok(undefined));

		const methodReads = git.commands.filter(
			(command) => command.program === "gh" && command.args.includes("graphql"),
		);
		expect(methodReads).toHaveLength(1);
		const merges = git.commands.filter(
			(command) => command.program === "gh" && command.args[0] === "pr",
		);
		expect(merges).toHaveLength(2);
	});
});

interface PendingCase {
	label: string;
	expected: PullRequestAction;
	start: (service: GithubService) => Promise<Result<void>>;
	isTarget: (command: GitCommand) => boolean;
}

const pendingCases: PendingCase[] = [
	{
		label: "merging",
		expected: "merging",
		start: (service) => service.merge(workspaceId),
		isTarget: (command) =>
			command.args[0] === "pr" &&
			command.args[1] === "merge" &&
			!command.args.includes("--auto") &&
			!command.args.includes("--disable-auto"),
	},
	{
		label: "enabling auto-merge",
		expected: "enabling_auto_merge",
		start: (service) => service.setAutoMerge(workspaceId, true),
		isTarget: (command) => command.args[0] === "pr" && command.args.includes("--auto"),
	},
	{
		label: "disabling auto-merge",
		expected: "disabling_auto_merge",
		start: (service) => service.setAutoMerge(workspaceId, false),
		isTarget: (command) => command.args[0] === "pr" && command.args.includes("--disable-auto"),
	},
	{
		label: "marking ready",
		expected: "marking_ready",
		start: (service) => service.markReady(workspaceId),
		isTarget: (command) => command.args[0] === "pr" && command.args[1] === "ready",
	},
	{
		label: "approving",
		expected: "approving",
		start: (service) => service.approve(workspaceId),
		isTarget: (command) =>
			command.args[0] === "api" && command.args.some((arg) => arg.includes("/reviews")),
	},
	{
		label: "requesting a review",
		expected: "requesting_review",
		start: (service) => service.requestReview(workspaceId, ["octocat"]),
		isTarget: (command) => command.args.includes("--add-reviewer"),
	},
	{
		label: "removing a review request",
		expected: "requesting_review",
		start: (service) => service.removeReviewRequest(workspaceId, "octocat"),
		isTarget: (command) => command.args.includes("--remove-reviewer"),
	},
	{
		label: "updating the title and body",
		expected: "updating",
		start: (service) => service.updateTitleAndBody(workspaceId, "T", "B"),
		isTarget: (command) => command.args[0] === "pr" && command.args[1] === "edit",
	},
];

describe("PR-06 pending action state", () => {
	for (const pending of pendingCases) {
		it(`shows ${pending.label} while the action runs`, async () => {
			let release: (() => void) | undefined;
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			let started: (() => void) | undefined;
			const reached = new Promise<void>((resolve) => {
				started = resolve;
			});
			const git = new FakeGitRunner(async (command) => {
				if (pending.isTarget(command)) {
					started?.();
					await blocked;
					return gitOutput();
				}
				return defaultAnswer(command);
			});
			const service = makeService(git);

			const running = pending.start(service);
			await reached;
			expect(service.pendingAction(workspaceId)).toBe(pending.expected);
			expect(service.pendingAction("other" as WorkspaceId)).toBeNull();

			release?.();
			expect(await running).toEqual(ok(undefined));
			expect(service.pendingAction(workspaceId)).toBeNull();
		});
	}
});

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

describe("PR-06 composition root", () => {
	it("reaches mark ready through the real container and actions", async () => {
		const harness = createTestContainer();
		const seen: ShellCommand[] = [];
		try {
			const repo = await seedRepo(harness.container, { rootPath: "/code/project" });
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspace",
				branch: "feat",
			});
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			expect(loaded.ok).toBe(true);
			harness.container.services.workspace.store.setState((state) => ({
				workspacesById: {
					...state.workspacesById,
					[workspace.id]: { ...workspace, prNumber: 12 },
				},
			}));
			harness.memory.controls.scriptShell((command) => {
				if (command.program !== "gh") return null;
				seen.push(command);
				return output();
			});

			const result = await harness.container.actions.pullRequests.markReady(workspace.id);

			expect(result).toEqual(ok(undefined));
			expect(seen.map((command) => [...command.args])).toContainEqual(["pr", "ready", "12"]);
		} finally {
			harness.close();
		}
	});

	it("returns a failed health write as a value, never a silent default", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.args[0] === "pr" && command.args[1] === "ready") {
				return err(appError("process_spawn", "gh could not start"));
			}
			return defaultAnswer(command);
		});
		const service = makeService(git);

		const result = await service.markReady(workspaceId);

		expect(!result.ok && result.error.code).toBe("process_spawn");
	});
});
