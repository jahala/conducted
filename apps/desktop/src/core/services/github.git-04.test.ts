import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import { GithubService } from "./github.ts";

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

const workspaceId = "workspace-1" as WorkspaceId;

function serviceWithRunner(git: GitRunner): GithubService {
	return new GithubService({
		git,
		agent: {} as never,
		contextOf: async () =>
			ok({ workspaceId, workspacePath: "/wt", branch: "feat", remote: "origin", prNumber: 12 }),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: "/tmp",
	});
}

describe("GIT-04 GitHub pending action", () => {
	it("reports a merge as running until it settles", async () => {
		let release: (() => void) | undefined;
		let started: (() => void) | undefined;
		const startedMerge = new Promise<void>((resolve) => {
			started = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});

		const run = async (
			command: GitCommand,
			_options: GitRunOptions,
		): Promise<Result<ShellOutput>> => {
			if (command.args[0] === "pr" && command.args[1] === "merge") {
				started?.();
				await blocked;
				return ok(output());
			}
			return ok(output("[true,true,true]"));
		};
		const git: GitRunner = {
			run,
			runChecked: async (command, options) => run(command, options),
			stdout: async (command, options) => {
				if (command.args[0] === "rev-parse") return ok("abc123");
				return run(command, options).then((result) =>
					result.ok ? ok(result.value.stdout.trim()) : result,
				);
			},
			start: async () => {
				throw new Error("start is not used by this test");
			},
			withWorktreeLock: (_path, work) => work(),
			withWorktreeAndRepoLocks: (_path, _root, work) => work(),
		};

		const service = serviceWithRunner(git);
		const merging = service.merge(workspaceId);
		await startedMerge;

		expect(service.pendingAction(workspaceId)).toBe("merging");
		expect(service.pendingAction("other-workspace" as WorkspaceId)).toBeNull();

		release?.();
		expect(await merging).toEqual(ok(undefined));
		expect(service.pendingAction(workspaceId)).toBeNull();
	});

	it("reports nothing when no pull request action runs", () => {
		const git: GitRunner = {
			run: async () => err(appError("git_failed", "not used")),
			runChecked: async () => err(appError("git_failed", "not used")),
			stdout: async () => err(appError("git_failed", "not used")),
			start: async () => {
				throw new Error("start is not used by this test");
			},
			withWorktreeLock: (_path, work) => work(),
			withWorktreeAndRepoLocks: (_path, _root, work) => work(),
		};
		expect(serviceWithRunner(git).pendingAction(workspaceId)).toBeNull();
	});
});
