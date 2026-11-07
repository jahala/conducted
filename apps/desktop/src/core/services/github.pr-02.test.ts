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
import {
	findPrTemplate,
	GithubService,
	PR_TEMPLATE_PATHS,
	type PrWorkspaceContext,
} from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "ws-1" as WorkspaceId;

const output = (exitCode: number, stdout = "", stderr = ""): Result<ShellOutput> =>
	ok({ exitCode, stdout, stderr });

interface Recorded {
	kind: "run" | "stdout";
	command: GitCommand;
	options: GitRunOptions;
}

function fakeGit(options: {
	stdout?: (command: GitCommand) => Result<string>;
	run?: (command: GitCommand) => Result<ShellOutput>;
}): GitRunner & { readonly records: readonly Recorded[] } {
	const records: Recorded[] = [];
	const runner: GitRunner & { readonly records: readonly Recorded[] } = {
		records,
		async run(command, runOptions) {
			records.push({ kind: "run", command, options: runOptions });
			return options.run?.(command) ?? output(0);
		},
		async runChecked(command, runOptions) {
			const result = await runner.run(command, runOptions);
			if (!result.ok) return result;
			if (result.value.exitCode !== 0) return err(appError("git_failed", result.value.stderr));
			return result;
		},
		async stdout(command, runOptions) {
			records.push({ kind: "stdout", command, options: runOptions });
			return options.stdout?.(command) ?? ok("");
		},
		async start() {
			throw new Error("not used in this test");
		},
		withWorktreeLock: async (_path, work) => work(),
		withWorktreeAndRepoLocks: async (_path, _root, work) => work(),
	};
	return runner;
}

function fakeAgent(): AgentMessenger & {
	readonly calls: readonly { workspaceId: WorkspaceId; text: string }[];
} {
	const calls: { workspaceId: WorkspaceId; text: string }[] = [];
	return {
		calls,
		sendInstruction: async (id, text) => {
			calls.push({ workspaceId: id, text });
			return ok("session-1" as SessionId);
		},
	};
}

const context = (overrides: Partial<PrWorkspaceContext> = {}): PrWorkspaceContext => ({
	workspaceId,
	workspacePath: "/tmp/workspace",
	branch: "feature/thing",
	remote: "origin",
	prNumber: null,
	targetBranch: "origin/main",
	customPrompt: null,
	...overrides,
});

function makeService(
	git: GitRunner,
	agent: AgentMessenger,
	overrides: Partial<PrWorkspaceContext> = {},
	setting?: <T>(key: string) => T,
): GithubService {
	return new GithubService({
		git,
		agent,
		contextOf: async () => ok(context(overrides)),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: "/tmp",
		...(setting === undefined ? {} : { setting }),
	});
}

const githubRemote = (command: GitCommand): Result<string> =>
	command.args[0] === "remote" ? ok("git@github.com:o/r.git") : ok("");

const tracked = (command: GitCommand): Result<string> =>
	command.args[0] === "ls-files"
		? ok("src/a.ts\n.github/pull_request_template.md\n")
		: githubRemote(command);

describe("PR-02 create a pull request", () => {
	it("sends the agent an instruction with the target, gh pr create and the template", async () => {
		const git = fakeGit({ stdout: tracked });
		const agent = fakeAgent();
		const service = makeService(git, agent, { customPrompt: "Use the release notes." });

		expect(await service.create(workspaceId, { draft: false })).toEqual(ok(undefined));

		expect(agent.calls).toHaveLength(1);
		const text = agent.calls[0]?.text ?? "";
		expect(text).toContain("gh pr create --base main");
		expect(text).toContain("git diff origin/main...");
		expect(text).toContain(".github/pull_request_template.md");
		expect(text).toContain("Use the release notes.");
		expect(text).not.toContain("uncommitted changes");
	});

	it("asks the agent for a draft pull request when the user chose one", async () => {
		const agent = fakeAgent();
		const service = makeService(fakeGit({ stdout: tracked }), agent);

		expect(await service.create(workspaceId, { draft: true })).toEqual(ok(undefined));
		expect(agent.calls[0]?.text).toContain("gh pr create --base main --draft");
	});

	it("asks the agent to commit when the worktree has uncommitted changes", async () => {
		const git = fakeGit({
			stdout: (command) => (command.args[0] === "status" ? ok(" M src/a.ts\n") : tracked(command)),
		});
		const agent = fakeAgent();
		const service = makeService(git, agent);

		expect(await service.create(workspaceId, { draft: false })).toEqual(ok(undefined));
		expect(agent.calls[0]?.text).toContain("uncommitted changes");
	});

	it("refuses a repository without a GitHub remote and does not message the agent", async () => {
		const git = fakeGit({
			stdout: (command) =>
				command.args[0] === "remote" ? ok("git@gitlab.com:o/r.git") : tracked(command),
		});
		const agent = fakeAgent();
		const service = makeService(git, agent);

		const result = await service.create(workspaceId, { draft: false });

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("github_not_github");
		expect(agent.calls).toHaveLength(0);
	});

	it("refuses when the workspace has no target branch", async () => {
		const git = fakeGit({ stdout: tracked });
		const agent = fakeAgent();
		const service = makeService(git, agent, { targetBranch: undefined });

		const result = await service.create(workspaceId, { draft: false });

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("github_target_unknown");
		expect(agent.calls).toHaveLength(0);
	});

	it("includes the workspace link only when its setting is on", async () => {
		const setting = (values: Record<string, unknown>): (<T>(key: string) => T) =>
			((key: string) => values[key]) as <T>(key: string) => T;

		const withLink = fakeAgent();
		await makeService(
			fakeGit({ stdout: tracked }),
			withLink,
			{},
			setting({ include_workspace_link_in_pr: true }),
		).create(workspaceId, { draft: false });
		expect(withLink.calls[0]?.text).toContain("conducted://workspace?id=ws-1");

		const withoutLink = fakeAgent();
		await makeService(
			fakeGit({ stdout: tracked }),
			withoutLink,
			{},
			setting({ include_workspace_link_in_pr: false }),
		).create(workspaceId, { draft: false });
		expect(withoutLink.calls[0]?.text).not.toContain("conducted://");
	});
});

describe("PR-02 open on GitHub", () => {
	it("runs gh pr create --web with the target and branch", async () => {
		const git = fakeGit({ stdout: githubRemote });
		const service = makeService(git, fakeAgent());

		expect(await service.openOnGithub(workspaceId)).toEqual(ok(undefined));

		const command = git.records.find((record) => record.command.program === "gh");
		expect(command?.command.args).toEqual([
			"pr",
			"create",
			"--web",
			"--base",
			"main",
			"--head",
			"feature/thing",
		]);
		expect(command?.options.cwd).toBe("/tmp/workspace");
	});

	it("does not open GitHub for a repository without a GitHub remote", async () => {
		const git = fakeGit({ stdout: () => ok("https://gitlab.com/o/r.git") });
		const service = makeService(git, fakeAgent());

		const result = await service.openOnGithub(workspaceId);

		expect(result.ok).toBe(false);
		expect(git.records.some((record) => record.command.program === "gh")).toBe(false);
	});
});

describe("PR-02 pull request template", () => {
	it("finds the template at GitHub's paths, ignoring case", () => {
		expect(findPrTemplate(["src/a.ts", ".github/PULL_REQUEST_TEMPLATE.md"])).toBe(
			".github/PULL_REQUEST_TEMPLATE.md",
		);
		expect(findPrTemplate(["docs/pull_request_template.md"])).toBe("docs/pull_request_template.md");
		expect(findPrTemplate(["pull_request_template.md"])).toBe("pull_request_template.md");
		expect(findPrTemplate(["src/a.ts"])).toBeNull();
		expect(PR_TEMPLATE_PATHS).toHaveLength(3);
	});
});
