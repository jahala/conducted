import { appError, err, ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitRunner } from "../git/runner.ts";
import { AGENT_DIFF_BUSY_MESSAGE, GitService, type WorkspaceGitContext } from "./git.ts";

const workspaceId = "ws-1" as WorkspaceId;

const context: WorkspaceGitContext = {
	workspaceId,
	workspacePath: "/repo/worktree",
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feat",
};

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

function runner(busyMarker: string | null): GitRunner {
	return new FakeGitRunner((command) => {
		const args = command.args;
		if (command.program === "stat") return ok(output("10\n"));
		if (args[0] === "branch" && args[1] === "--show-current") return ok(output("feat\n"));
		if (args[0] === "merge-base") return ok(output("mb\n"));
		if (args[0] === "rev-parse" && args.includes("--git-path")) {
			const marker = args.at(-1);
			return ok(output(marker === busyMarker ? `.git/${marker}\n` : ""));
		}
		if (args[0] === "diff") return ok(output("diff --git a/a.ts b/a.ts\n"));
		return ok(output(""));
	});
}

const service = (git: GitRunner): GitService =>
	new GitService({
		git,
		cache: {} as never,
		contextOf: async () => ok(context),
		agent: {} as never,
		renameWorkspaceBranch: async () => ok(undefined),
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
		now: () => 0,
		fs: {
			trash: async () => ok(undefined),
			readText: async () => err(appError("fs_not_found", "missing")),
			writeTextAtomic: async () => ok(undefined),
			mkdirp: async () => ok(undefined),
			stat: async () => err(appError("fs_not_found", "missing")),
			paths: { home: "", appData: "", temp: "", resources: "" },
		},
	});

describe("SIDE-12 the agent diff refuses a busy repository", () => {
	for (const marker of ["MERGE_HEAD", "rebase-merge", "rebase-apply"]) {
		it(`reports git_busy while ${marker} is present`, async () => {
			const result = await service(runner(marker)).agentDiff(workspaceId, undefined, false);
			expect(result).toEqual({
				ok: false,
				error: { code: "git_busy", message: AGENT_DIFF_BUSY_MESSAGE },
			});
		});
	}

	it("returns the diff when no operation is in progress", async () => {
		const result = await service(runner(null)).agentDiff(workspaceId, "src/a.ts", true);
		expect(result).toEqual(ok("diff --git a/a.ts b/a.ts"));
	});
});
