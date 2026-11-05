import { ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	commandText,
	FakeGitRunner,
	type GitHandler,
	gitOutput,
} from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitCache } from "./git-cache.ts";
import { checkLogTail, GithubService, type GithubServiceDeps, parseCheckJob } from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "w1" as WorkspaceId;

function service(handler: GitHandler) {
	const git = new FakeGitRunner(handler);
	const service = new GithubService({
		git,
		cache: {} as GitCache,
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
