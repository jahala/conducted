/**
 * @feature GIT-08 Change the target branch
 * Owns: tests for moving an open pull request's base with `gh pr edit --base`.
 * Behaviour: services-map.md 3.11 (retarget) and 3.7.5 (change base).
 * Test first: an open pull request's base changes to the chosen branch.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import { GithubService, type PrWorkspaceContext } from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "workspace-1" as WorkspaceId;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

function fakeGit(handler: (command: GitCommand) => Result<ShellOutput>): {
	git: GitRunner;
	commands: GitCommand[];
} {
	const commands: GitCommand[] = [];
	const run = async (command: GitCommand, _options: GitRunOptions) => {
		commands.push(command);
		return handler(command);
	};
	const runChecked = async (command: GitCommand, options: GitRunOptions) => {
		const result = await run(command, options);
		if (!result.ok) return result;
		return (command.okExitCodes ?? [0]).includes(result.value.exitCode)
			? result
			: err(appError("git_failed", result.value.stderr.trim() || "gh failed"));
	};
	return {
		commands,
		git: {
			run,
			runChecked,
			stdout: async (command, options) => {
				const result = await runChecked(command, options);
				return result.ok ? ok(result.value.stdout.trim()) : result;
			},
			start: async () => {
				throw new Error("start is not used");
			},
			withWorktreeLock: (_path, work) => work(),
			withWorktreeAndRepoLocks: (_path, _root, work) => work(),
		},
	};
}

const context = (prNumber: number | null): PrWorkspaceContext => ({
	workspaceId,
	workspacePath: "/wt",
	branch: "feat",
	remote: "origin",
	prNumber,
	targetBranch: "origin/main",
});

function makeService(git: GitRunner, prNumber: number | null): GithubService {
	return new GithubService({
		git,
		agent: {} as AgentMessenger,
		contextOf: async () => ok(context(prNumber)),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: "/tmp",
	});
}

describe("GIT-08 move an open pull request's base", () => {
	it("edits the base of an open pull request", async () => {
		const { git, commands } = fakeGit((command) =>
			command.args[1] === "view" ? ok(output("OPEN\n")) : ok(output()),
		);
		const service = makeService(git, 12);

		const result = await service.moveOpenPullRequestBase(workspaceId, "develop");

		expect(result).toEqual(ok(true));
		expect(commands.map((command) => command.args)).toEqual([
			["pr", "view", "12", "--json", "state", "--jq", ".state"],
			["pr", "edit", "12", "--base", "develop"],
		]);
	});

	it("does nothing when the pull request is not open", async () => {
		const { git, commands } = fakeGit(() => ok(output("CLOSED\n")));
		const service = makeService(git, 12);

		const result = await service.moveOpenPullRequestBase(workspaceId, "develop");

		expect(result).toEqual(ok(false));
		expect(commands).toHaveLength(1);
	});

	it("does nothing when the workspace has no pull request", async () => {
		const { git, commands } = fakeGit(() => ok(output("OPEN\n")));
		const service = makeService(git, null);

		const result = await service.moveOpenPullRequestBase(workspaceId, "develop");

		expect(result).toEqual(ok(false));
		expect(commands).toEqual([]);
	});

	it("returns the gh failure when the base could not be changed", async () => {
		const { git } = fakeGit((command) =>
			command.args[1] === "view" ? ok(output("OPEN\n")) : ok(output("", "no write access", 1)),
		);
		const service = makeService(git, 12);

		const result = await service.moveOpenPullRequestBase(workspaceId, "develop");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("no write access");
	});
});
