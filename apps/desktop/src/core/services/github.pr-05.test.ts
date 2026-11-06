// @vitest-environment node
/**
 * @feature PR-05 "Fix errors": send failing checks to the agent
 * Owns: the tests that failing checks and their log tails reach the agent as one instruction, that
 * a repository prompt replaces its text, and that the composition root supplies that prompt.
 * Behaviour: ui-map.md 3.6 (the Fix errors action), 6 Actions (a repo prompt replaces the default
 * text), services-map.md 3.7.6 (fixing CI errors goes to the agent as an instruction).
 * Test first: two failing checks of one pull request send one instruction with both log tails.
 */
import { appError, err, ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import {
	commandText,
	FakeGitRunner,
	type GitHandler,
	gitOutput,
} from "../../test/fake-git-runner.ts";
import { localSettingsFile } from "../app-paths.ts";
import type { CheckRun, PullRequest } from "../model.ts";
import type { GitCache } from "./git-cache.ts";
import { GithubService, type GithubServiceDeps } from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";
import { tomlCodec } from "./toml-codec.ts";

const workspaceId = "w1" as WorkspaceId;

const check = (name: string, state: CheckRun["state"], url: string | null): CheckRun => ({
	name,
	state,
	url,
	startedAt: null,
	completedAt: null,
	required: false,
});

const pullRequest = (checks: CheckRun[]): PullRequest => ({
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "Checks",
	body: "",
	state: "open",
	mergeable: "unknown",
	reviewDecision: null,
	checks,
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: null,
	viewerDidAuthor: false,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
});

function service(handler: GitHandler, prompt: string | null = null) {
	const git = new FakeGitRunner(handler);
	const calls: { workspaceId: WorkspaceId; text: string }[] = [];
	const agent: AgentMessenger = {
		sendInstruction: async (id, text) => {
			calls.push({ workspaceId: id, text });
			return ok("session-1" as SessionId);
		},
	};
	const github = new GithubService({
		git,
		cache: {} as GitCache,
		agent,
		contextOf: async () =>
			ok({
				workspaceId,
				workspacePath: "/wt",
				branch: "feature/thing",
				remote: "origin",
				prNumber: 12,
				targetBranch: "origin/main",
				customPrompt: null,
			}),
		onMerged: () => {},
		now: () => 1,
		probeCwd: "/tmp",
		fixErrorsPromptOf: async () => ok(prompt),
	} satisfies GithubServiceDeps);
	return { git, github, calls };
}

const showPullRequest = (github: GithubService, pr: PullRequest): void => {
	github.store.setState((state) => ({
		...state,
		byWorkspace: {
			...state.byWorkspace,
			[workspaceId]: { pullRequest: pr, unavailable: "none", fetchedAt: 1 },
		},
	}));
};

describe("PR-05 fix errors sends failing checks to the agent", () => {
	it("sends one instruction with every failing check and its log tail", async () => {
		const { git, github, calls } = service((command) => {
			if (commandText(command).includes("actions/jobs/1/logs")) {
				return gitOutput("build error\n", "", 0);
			}
			if (commandText(command).includes("actions/jobs/2/logs")) {
				return gitOutput("test error\n", "", 0);
			}
			return gitOutput("", "", 0);
		});
		showPullRequest(
			github,
			pullRequest([
				check("build", "failure", "https://github.com/o/r/actions/runs/77/job/1"),
				check("test", "failure", "https://github.com/o/r/actions/runs/88/job/2"),
				check("lint", "success", "https://github.com/o/r/actions/runs/99/job/3"),
			]),
		);

		expect(await github.fixErrors(workspaceId)).toEqual(ok(undefined));

		expect(calls).toHaveLength(1);
		const text = calls[0]?.text ?? "";
		expect(text).toContain("feature/thing");
		expect(text).toContain("build");
		expect(text).toContain("build error");
		expect(text).toContain("test");
		expect(text).toContain("test error");
		expect(text).not.toContain("lint");
		expect(
			git.commands.filter((command) => commandText(command).includes("actions/jobs/")),
		).toHaveLength(2);
	});

	it("still sends a failed check whose log is unavailable", async () => {
		const { github, calls } = service(() => gitOutput("", "", 0));
		showPullRequest(
			github,
			pullRequest([check("deploy", "failure", "https://vercel.example/deploy/5")]),
		);

		expect(await github.fixErrors(workspaceId)).toEqual(ok(undefined));

		const text = calls[0]?.text ?? "";
		expect(text).toContain("deploy");
		expect(text).toContain("No log was available for this check.");
	});

	it("refuses when no check is failing and sends nothing", async () => {
		const { git, github, calls } = service(() => gitOutput("", "", 0));
		showPullRequest(
			github,
			pullRequest([check("build", "success", "https://github.com/o/r/actions/runs/1/job/1")]),
		);

		const result = await github.fixErrors(workspaceId);

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("github_no_failed_checks");
		expect(calls).toHaveLength(0);
		expect(git.commands).toHaveLength(0);
	});

	it("sends the repository's Fix errors prompt instead of the default text", async () => {
		const custom = "Use the migration checklist.";
		const { git, github, calls } = service(() => gitOutput("", "", 0), custom);
		showPullRequest(
			github,
			pullRequest([check("build", "failure", "https://github.com/o/r/actions/runs/77/job/1")]),
		);

		expect(await github.fixErrors(workspaceId)).toEqual(ok(undefined));

		expect(calls[0]?.text).toBe(custom);
		expect(
			git.commands.filter((command) => commandText(command).includes("actions/jobs/")),
		).toHaveLength(0);
	});

	it("returns the agent's failure instead of reporting success", async () => {
		const failure = appError("send_failed", "The agent did not answer.");
		const git = new FakeGitRunner(() => gitOutput("", "", 0));
		const github = new GithubService({
			git,
			cache: {} as GitCache,
			agent: { sendInstruction: async () => err(failure) },
			contextOf: async () =>
				ok({
					workspaceId,
					workspacePath: "/wt",
					branch: "feature/thing",
					remote: "origin",
					prNumber: 12,
					targetBranch: "origin/main",
					customPrompt: null,
				}),
			onMerged: () => {},
			now: () => 1,
			probeCwd: "/tmp",
			fixErrorsPromptOf: async () => ok(null),
		} satisfies GithubServiceDeps);
		showPullRequest(github, pullRequest([check("build", "failure", null)]));

		expect(await github.fixErrors(workspaceId)).toEqual(err(failure));
	});
});

describe("PR-05 composition root", () => {
	it("sends the repository's Fix errors prompt through the real container", async () => {
		const custom = "Use the migration checklist.";
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container);
			harness.memory.controls.files.set(
				localSettingsFile(repo.rootPath),
				tomlCodec.stringify({ prompts: { fix_errors: custom } }),
			);
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			expect(loaded.ok).toBe(true);
			const workspace = await seedWorkspace(harness.container, { repoId: repo.id });

			harness.container.services.github.store.setState({
				byWorkspace: {
					[workspace.id]: {
						pullRequest: pullRequest([check("build", "failure", null)]),
						unavailable: "none",
						fetchedAt: 1,
					},
				},
			});
			const sent: string[] = [];
			vi.spyOn(harness.container.services.sessions, "sendInstruction").mockImplementation(
				async (_workspaceId, text) => {
					sent.push(text);
					return ok("test-session" as SessionId);
				},
			);

			const result = await harness.container.actions.pullRequests.fixErrors(workspace.id);

			expect(result).toEqual(ok(undefined));
			expect(sent).toEqual([custom]);
		} finally {
			harness.container.services.repo.dispose();
			harness.close();
		}
	});
});
