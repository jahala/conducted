import { ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	commandText,
	FakeGitRunner,
	type GitHandler,
	gitOutput,
} from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { CheckRun, PullRequest } from "../model.ts";
import { checkLogTail, GithubService, type GithubServiceDeps, parseCheckJob } from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "w1" as WorkspaceId;

function service(handler: GitHandler) {
	const git = new FakeGitRunner(handler);
	const service = new GithubService({
		git,
		agent: {} as AgentMessenger,
		contextOf: async () =>
			ok({ workspaceId, workspacePath: "/wt", branch: "feat", remote: "origin", prNumber: 12 }),
		onMerged: () => {},
		now: () => 1,
		probeCwd: "/tmp",
	} satisfies GithubServiceDeps);
	return { git, service };
}

describe("PR-04 check job URL", () => {
	it("reads the run and job ids from a details URL", () => {
		expect(parseCheckJob("https://github.com/o/r/actions/runs/123/job/456")).toEqual({
			runId: "123",
			jobId: "456",
		});
	});

	it("has no job for an external status or no URL", () => {
		expect(parseCheckJob(null)).toBeNull();
		expect(parseCheckJob("https://example.test/status")).toBeNull();
	});
});

describe("PR-04 check log tail", () => {
	it("keeps only the last 1000 lines", () => {
		const lines = Array.from({ length: 1005 }, (_, index) => `line ${index}`);
		const tail = checkLogTail(lines.join("\n"));
		expect(tail.split("\n")).toHaveLength(1000);
		expect(tail.startsWith("line 5")).toBe(true);
	});

	it("leaves a short log alone", () => {
		expect(checkLogTail("a\nb")).toBe("a\nb");
	});
});

describe("PR-04 read a check log", () => {
	it("retries without --allow-escape-sequences when gh does not know it", async () => {
		const { git, service: github } = service((command: GitCommand) => {
			if (command.args.includes("--allow-escape-sequences")) {
				return gitOutput("", "unknown flag: --allow-escape-sequences", 1);
			}
			return gitOutput("first\nsecond\n", "", 0);
		});

		const result = await github.readCheckLog(
			workspaceId,
			"https://github.com/o/r/actions/runs/123/job/456",
		);

		expect(result).toEqual(ok("first\nsecond\n"));
		expect(git.commands).toHaveLength(2);
		expect(commandText(git.commands[0] as GitCommand)).toContain("--allow-escape-sequences");
		expect(commandText(git.commands[1] as GitCommand)).not.toContain("--allow-escape-sequences");
	});

	it("reports a check that has no job instead of asking GitHub", async () => {
		const { git, service: github } = service(() => gitOutput("", "", 0));
		const result = await github.readCheckLog(workspaceId, null);
		expect(result.ok).toBe(false);
		expect(git.commands).toHaveLength(0);
	});
});

describe("PR-04 expired check logs", () => {
	it("tells an expired log apart from a failed read", async () => {
		const { service: github } = service(() => gitOutput("", "gh: Not Found (HTTP 404)", 1));
		const expired = await github.readCheckLog(
			workspaceId,
			"https://github.com/o/r/actions/runs/123/job/456",
		);
		expect(expired.ok).toBe(false);
		if (!expired.ok) expect(expired.error.code).toBe("github_check_log_expired");

		const { service: other } = service(() => gitOutput("", "gh: Server Error (HTTP 502)", 1));
		const failed = await other.readCheckLog(
			workspaceId,
			"https://github.com/o/r/actions/runs/123/job/456",
		);
		expect(failed.ok).toBe(false);
		if (!failed.ok) expect(failed.error.code).toBe("github_check_log_failed");
	});
});

describe("PR-04 re-run failed checks", () => {
	const check = (name: string, state: CheckRun["state"], url: string | null): CheckRun => ({
		name,
		state,
		url,
		startedAt: null,
		completedAt: null,
		required: false,
	});

	const withChecks = (checks: CheckRun[]): PullRequest => ({
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

	const showPullRequest = (github: GithubService, pullRequest: PullRequest) => {
		github.store.setState((state) => ({
			...state,
			byWorkspace: {
				...state.byWorkspace,
				[workspaceId]: { pullRequest, unavailable: "none", fetchedAt: 1 },
			},
		}));
	};

	const reruns = (git: FakeGitRunner) =>
		git.commands.map(commandText).filter((text) => text.includes("run rerun"));

	it("sends one gh run rerun --failed for two failed jobs of one run", async () => {
		const { git, service: github } = service(() => gitOutput("", "", 0));
		showPullRequest(
			github,
			withChecks([
				check("build", "failure", "https://github.com/o/r/actions/runs/77/job/1"),
				check("test", "failure", "https://github.com/o/r/actions/runs/77/job/2"),
				check("lint", "failure", "https://github.com/o/r/actions/runs/88/job/3"),
				check("docs", "success", "https://github.com/o/r/actions/runs/99/job/4"),
				check("vercel", "failure", "https://vercel.example/deploy/5"),
			]),
		);

		expect(await github.rerunFailedChecks(workspaceId)).toEqual(ok(undefined));

		expect(reruns(git)).toEqual(["gh run rerun 77 --failed", "gh run rerun 88 --failed"]);
		expect(
			git.calls.find((call) => commandText(call.command).includes("run rerun"))?.options.cwd,
		).toBe("/wt");
	});

	it("refuses when no failed check names a workflow run", async () => {
		const { git, service: github } = service(() => gitOutput("", "", 0));
		showPullRequest(
			github,
			withChecks([check("vercel", "failure", "https://vercel.example/deploy/5")]),
		);

		const result = await github.rerunFailedChecks(workspaceId);

		expect(result.ok).toBe(false);
		expect(reruns(git)).toEqual([]);
	});
});
