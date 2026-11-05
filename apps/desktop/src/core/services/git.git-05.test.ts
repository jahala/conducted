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
import type { GitRunner } from "../git/runner.ts";
import { GitService, type WorkspaceGitContext } from "./git.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "ws-1" as WorkspaceId;

const output = (): Result<ShellOutput> => ok({ stdout: "", stderr: "", exitCode: 0 });

function fakeGit(): GitRunner & { readonly commands: readonly GitCommand[] } {
	const commands: GitCommand[] = [];
	const git: GitRunner & { readonly commands: readonly GitCommand[] } = {
		commands,
		async run(command) {
			commands.push(command);
			return output();
		},
		async runChecked(command) {
			commands.push(command);
			return output();
		},
		async stdout(command) {
			commands.push(command);
			return ok("");
		},
		async start() {
			throw new Error("start is not used by commit and push");
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
	contextOf: (id: WorkspaceId) => Promise<Result<WorkspaceGitContext>> = async () => ok(context()),
): GitService {
	return new GitService({
		git,
		cache: {} as never,
		contextOf,
		agent,
		now: () => 1_000,
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
		fs: {
			trash: async () => ok(undefined),
			readText: async () => err(appError("fs_not_found", "missing")),
			writeTextAtomic: async () => ok(undefined),
			mkdirp: async () => ok(undefined),
			stat: async () => err(appError("fs_not_found", "missing")),
			paths: { home: "", appData: "", temp: "", resources: "" },
		},
	});
}

describe("GIT-05 commit and push", () => {
	it("sends the agent one instruction and runs no git commit itself", async () => {
		const git = fakeGit();
		const agent = fakeAgent();
		const service = makeService(git, agent);

		expect(await service.commitAndPush(workspaceId)).toEqual(ok(undefined));

		expect(agent.calls).toHaveLength(1);
		expect(agent.calls[0]?.workspaceId).toBe(workspaceId);
		const text = agent.calls[0]?.text ?? "";
		expect(text.toLowerCase()).toContain("commit");
		expect(text.toLowerCase()).toContain("push");
		expect(text).toContain("feature/thing");
		expect(git.commands.some((command) => command.args[0] === "commit")).toBe(false);
	});

	it("does not message the agent when the workspace cannot be read", async () => {
		const failure = appError("workspace_unknown", "That workspace no longer exists.");
		const agent = fakeAgent();
		const service = makeService(fakeGit(), agent, async () => err(failure));

		expect(await service.commitAndPush(workspaceId)).toEqual(err(failure));
		expect(agent.calls).toHaveLength(0);
	});

	it("returns the agent's failure instead of reporting success", async () => {
		const failure = appError("agent_unavailable", "No agent is available.");
		const agent: AgentMessenger = {
			sendInstruction: async () => err(failure),
		};
		const service = makeService(fakeGit(), agent);

		expect(await service.commitAndPush(workspaceId)).toEqual(err(failure));
	});
});
