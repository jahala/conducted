import {
	appError,
	err,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import { GitService, type WorkspaceGitContext } from "./git.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "ws-1" as WorkspaceId;

const output = (stdout = "", exitCode = 0): ShellOutput => ({ stdout, stderr: "", exitCode });

interface FakeGitOptions {
	/** The value git prints for `pull.rebase`, or null for an unset key. */
	pullRebase?: string | null;
	/** When set, the config command fails instead of printing a value. */
	configFailure?: ShellOutput;
}

function fakeGit(options: FakeGitOptions = {}): GitRunner & {
	readonly commands: readonly GitCommand[];
} {
	const commands: GitCommand[] = [];
	const git: GitRunner & { readonly commands: readonly GitCommand[] } = {
		commands,
		async run(command, _options: GitRunOptions) {
			commands.push(command);
			if (command.args[0] === "config" && command.args[2] === "pull.rebase") {
				if (options.configFailure !== undefined) return ok(options.configFailure);
				const value = options.pullRebase ?? null;
				return ok(value === null ? output("", 1) : output(`${value}\n`, 0));
			}
			return ok(output());
		},
		async runChecked(command, runOptions) {
			return git.run(command, runOptions);
		},
		async stdout(command, runOptions) {
			const result = await git.run(command, runOptions);
			return result.ok ? ok(result.value.stdout.trim()) : result;
		},
		async start() {
			throw new Error("start is not used by resolve conflicts");
		},
		withWorktreeLock: (_worktreePath, work) => work(),
		withWorktreeAndRepoLocks: (_worktreePath, _repoRootPath, work) => work(),
	};
	return git;
}

function fakeAgent(): AgentMessenger & {
	readonly calls: readonly { workspaceId: WorkspaceId; text: string }[];
} {
	const calls: { workspaceId: WorkspaceId; text: string }[] = [];
	let next = 0;
	return {
		calls,
		sendInstruction: async (id, text) => {
			calls.push({ workspaceId: id, text });
			next += 1;
			return ok(`session-${next}` as SessionId);
		},
	};
}

const context = (overrides: Partial<WorkspaceGitContext> = {}): WorkspaceGitContext => ({
	workspaceId,
	workspacePath: "/tmp/workspace",
	repoRootPath: "/tmp/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feature/thing",
	...overrides,
});

function makeService(
	git: GitRunner,
	agent: AgentMessenger,
	options: {
		contextOf?: (id: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
		promptFor?: (id: WorkspaceId) => Promise<Result<string | null>>;
	} = {},
): GitService {
	return new GitService({
		git,
		cache: {} as never,
		contextOf: options.contextOf ?? (async () => ok(context())),
		agent,
		promptFor: options.promptFor,
		now: () => 1_000,
		fs: {
			trash: async () => ok(undefined),
			readText: async () => err(appError("fs_not_found", "missing")),
			writeTextAtomic: async () => ok(undefined),
			mkdirp: async () => ok(undefined),
			stat: async () => err(appError("fs_not_found", "missing")),
			paths: { home: "", appData: "", temp: "", resources: "" },
		},
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
	});
}

describe("GIT-07 resolve conflicts", () => {
	it("reads pull.rebase and sends the rebase instruction when it is true", async () => {
		const git = fakeGit({ pullRebase: "true" });
		const agent = fakeAgent();
		const service = makeService(git, agent);

		expect(await service.resolveConflicts(workspaceId)).toEqual(ok(undefined));

		expect(agent.calls).toHaveLength(1);
		expect(agent.calls[0]?.workspaceId).toBe(workspaceId);
		const text = agent.calls[0]?.text ?? "";
		expect(text).toContain("Rebase");
		expect(text).toContain("origin/main");
		expect(text).not.toContain("origin/origin/main");
		expect(text).toContain("--force-with-lease");
		expect(git.commands.some((command) => command.args[0] === "rebase")).toBe(false);
		expect(git.commands.some((command) => command.args[0] === "merge")).toBe(false);
	});

	it("sends the merge instruction when pull.rebase is unset", async () => {
		const git = fakeGit({ pullRebase: null });
		const agent = fakeAgent();
		const service = makeService(git, agent);

		expect(await service.resolveConflicts(workspaceId)).toEqual(ok(undefined));

		const text = agent.calls[0]?.text ?? "";
		expect(text).toContain("Merge");
		expect(text.toLowerCase()).not.toContain("force");
	});

	it("sends the merge instruction when pull.rebase is false", async () => {
		const agent = fakeAgent();
		const service = makeService(fakeGit({ pullRebase: "false" }), agent);

		expect(await service.resolveConflicts(workspaceId)).toEqual(ok(undefined));

		expect(agent.calls[0]?.text).toContain("Merge");
	});

	it("uses the repository's custom prompt in place of the default text", async () => {
		const agent = fakeAgent();
		const service = makeService(fakeGit({ pullRebase: "true" }), agent, {
			promptFor: async () => ok("Keep both sides of every conflict."),
		});

		expect(await service.resolveConflicts(workspaceId)).toEqual(ok(undefined));

		expect(agent.calls[0]?.text).toBe("Keep both sides of every conflict.");
	});

	it("does not message the agent when the workspace cannot be read", async () => {
		const failure = appError("workspace_unknown", "That workspace no longer exists.");
		const agent = fakeAgent();
		const service = makeService(fakeGit(), agent, {
			contextOf: async () => err(failure),
		});

		expect(await service.resolveConflicts(workspaceId)).toEqual(err(failure));
		expect(agent.calls).toHaveLength(0);
	});

	it("returns a config read failure instead of guessing a strategy", async () => {
		const agent = fakeAgent();
		const service = makeService(
			fakeGit({ configFailure: { stdout: "", stderr: "bad config", exitCode: 128 } }),
			agent,
		);

		const result = await service.resolveConflicts(workspaceId);

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("git_failed");
		expect(agent.calls).toHaveLength(0);
	});

	it("returns a custom prompt read failure instead of sending built-in text", async () => {
		const failure = appError("repo_config_unloaded", "The repository settings are still loading.");
		const agent = fakeAgent();
		const service = makeService(fakeGit(), agent, {
			promptFor: async () => err(failure),
		});

		expect(await service.resolveConflicts(workspaceId)).toEqual(err(failure));
		expect(agent.calls).toHaveLength(0);
	});

	it("returns the agent's failure instead of reporting success", async () => {
		const failure = appError("agent_unavailable", "No agent is available.");
		const agent: AgentMessenger = {
			sendInstruction: async () => err(failure),
		};
		const service = makeService(fakeGit(), agent);

		expect(await service.resolveConflicts(workspaceId)).toEqual(err(failure));
	});
});
