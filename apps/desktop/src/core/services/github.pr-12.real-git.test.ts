// @vitest-environment node
/**
 * @feature PR-12 Catch up a stack branch after GitHub rewrites it
 * Owns: the catch-up against a real git repository. The branch is force-pushed away from its local
 * tip, then the guarded rebase moves the branch onto the new upstream tip and records the new
 * baseline.
 * Behaviour: services-map.md 3.8.3 (a remote rewrite, the guarded rebase, the baseline ref).
 * A change between planning and the rebase (the upstream moves, or the remote's URL changes) trips
 * the sequence-editor guard: git stops before it replays a commit and the branch stays as it was.
 * Test first: a diverged stack branch whose local tip the upstream reflog once held is rebased onto
 * the rewritten upstream, and the baseline ref takes the new tip.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appError, err, ok, type WorkspaceId } from "@conducted/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Shell, ShellCommand } from "../../platform/platform.ts";
import { FakeGitRunner, type GitAnswer, gitOutput } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import { KeyedMutex } from "../git/locks.ts";
import { ShellGitRunner } from "../git/runner.ts";
import type { PullRequest } from "../model.ts";
import { GithubService } from "./github.ts";

const workspaceId = "ws-1" as WorkspaceId;

const realShell: Shell = {
	run: (command: ShellCommand) =>
		new Promise((resolve) => {
			const child = spawn(command.program, [...command.args], {
				cwd: command.cwd,
				env: { ...process.env, ...command.env },
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on("error", (error) => resolve(err(appError("process_spawn", error.message))));
			child.on("close", (code) => resolve(ok({ exitCode: code ?? 0, stdout, stderr })));
			if (command.stdin !== undefined) child.stdin.end(command.stdin);
		}),
	start: () => {
		throw new Error("start is not used here");
	},
	loginEnv: async () => ({ shell: "/bin/zsh", path: process.env.PATH ?? "", zdotdir: null }),
};

const realGit = new ShellGitRunner({
	shell: realShell,
	locks: new KeyedMutex(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	log: () => undefined,
	programsBin: "",
});

const git = (cwd: string, ...args: string[]): string =>
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd, stdio: "pipe", encoding: "utf8" },
	).trim();

function commit(cwd: string, file: string, text: string, message: string): string {
	writeFileSync(join(cwd, file), text);
	git(cwd, "add", file);
	git(cwd, "commit", "-q", "-m", message);
	return git(cwd, "rev-parse", "HEAD");
}

let root: string;
let origin: string;
let author: string;
let workspace: string;
let base: string;
let localTip: string;
let upstreamTip: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "conducted-stack-catch-up-"));
	origin = join(root, "origin");
	author = join(root, "author");
	workspace = join(root, "workspace");
	execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
	execFileSync("git", ["clone", "-q", origin, author], { stdio: "pipe" });
	base = commit(author, "base.txt", "base\n", "base");
	git(author, "checkout", "-q", "-b", "feat-b");
	commit(author, "b.txt", "b\n", "b1");
	git(author, "push", "-q", "-u", "origin", "main", "feat-b");

	execFileSync("git", ["clone", "-q", origin, workspace], { stdio: "pipe" });
	git(workspace, "checkout", "-q", "feat-b");
	// The local commit goes to the remote first, so the remote's reflog remembers it.
	localTip = commit(workspace, "local.txt", "local\n", "local change");
	git(workspace, "push", "-q", "origin", "feat-b");

	// GitHub rewrites the branch away from the local tip.
	git(author, "fetch", "-q", "origin");
	git(author, "checkout", "-q", "-B", "rewritten", base);
	upstreamTip = commit(author, "upstream.txt", "upstream\n", "rewritten upstream");
	git(author, "push", "-q", "--force", "origin", "rewritten:feat-b");

	git(workspace, "fetch", "-q", "origin");
	// The remote's URL only has to name GitHub for the stack read; the rewrites above are done.
	git(workspace, "remote", "set-url", "origin", "git@github.com:o/r.git");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const stackEntryAnswer = JSON.stringify({
	data: {
		repository: {
			pullRequest: {
				number: 12,
				stackEntry: { position: 2, stack: { number: 5, size: 2, baseRefName: "main" } },
			},
		},
	},
});

const membersAnswer = (): string =>
	JSON.stringify({
		pull_requests: [
			{
				number: 11,
				title: "Below",
				state: "OPEN",
				draft: false,
				merged_at: null,
				head: { ref: "feat-a", sha: base },
				base: { ref: "main", sha: base },
			},
			{
				number: 12,
				title: "Current",
				state: "OPEN",
				draft: false,
				merged_at: null,
				head: { ref: "feat-b", sha: localTip },
				base: { ref: "feat-a", sha: base },
			},
		],
	});

const readinessAnswer = JSON.stringify({
	data: {
		repository: {
			pr0: { number: 11, mergeStateStatus: "CLEAN" },
			pr1: { number: 12, mergeStateStatus: "CLEAN" },
		},
	},
});

function ghAnswer(command: GitCommand): GitAnswer {
	if (command.args.includes("graphql")) {
		if (command.args.some((arg) => arg.includes("stackEntry"))) return gitOutput(stackEntryAnswer);
		if (command.args.some((arg) => arg.includes("mergeStateStatus"))) {
			return gitOutput(readinessAnswer);
		}
		return gitOutput();
	}
	if (command.args[1]?.includes("/stacks/5") === true) return gitOutput(membersAnswer());
	return gitOutput();
}

function pullRequest(): PullRequest {
	return {
		number: 12,
		url: "https://github.com/o/r/pull/12",
		title: "Current",
		body: "",
		state: "open",
		mergeable: "mergeable",
		reviewDecision: null,
		checks: [],
		inMergeQueue: false,
		autoMergeEnabled: false,
		baseBranch: "main",
		authorLogin: "octocat",
		viewerDidAuthor: false,
		viewerCanMerge: true,
		mergeMethod: "squash",
		reviewers: [],
		deployments: [],
		updatedAt: 1,
	};
}

/** `beforeRebase` runs just before git starts the guarded rebase, after the catch-up planned it. */
function makeService(beforeRebase: () => void = () => {}): {
	service: GithubService;
	gitRunner: FakeGitRunner;
} {
	const gitRunner = new FakeGitRunner((command, options) => {
		if (command.program === "gh") return ghAnswer(command);
		if (command.args[0] === "rebase" && command.args[1] === "--interactive") beforeRebase();
		return realGit.run(command, options);
	});
	const service = new GithubService({
		git: gitRunner,
		agent: {} as never,
		contextOf: async () =>
			ok({
				workspaceId,
				workspacePath: workspace,
				repoRootPath: workspace,
				branch: "feat-b",
				remote: "origin",
				prNumber: 12,
			}),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: workspace,
	});
	service.store.setState({
		byWorkspace: {
			[workspaceId]: { pullRequest: pullRequest(), unavailable: "none", fetchedAt: 1 },
		},
	});
	return { service, gitRunner };
}

describe("PR-12 a real rewritten stack branch", () => {
	const changes = [
		{
			name: "the upstream moves",
			change: () => git(workspace, "update-ref", "refs/remotes/origin/feat-b", base),
			undo: () => git(workspace, "update-ref", "refs/remotes/origin/feat-b", upstreamTip),
		},
		{
			name: "the remote's URL changes",
			change: () => git(workspace, "remote", "set-url", "origin", "git@github.com:o/other.git"),
			undo: () => git(workspace, "remote", "set-url", "origin", "git@github.com:o/r.git"),
		},
	];
	for (const { name, change, undo } of changes) {
		it(`stops before any commit is replayed when ${name} after planning`, async () => {
			const { service } = makeService(change);
			try {
				const result = await service.catchUpStackBranch(workspaceId, () => false);

				expect(result.ok).toBe(false);
				expect(git(workspace, "rev-parse", "HEAD")).toBe(localTip);
				expect(git(workspace, "rev-parse", "refs/heads/feat-b")).toBe(localTip);
				expect(git(workspace, "symbolic-ref", "HEAD")).toBe("refs/heads/feat-b");
				const rebaseDir = git(workspace, "rev-parse", "--git-path", "rebase-merge");
				expect(existsSync(join(workspace, rebaseDir))).toBe(false);
				expect(
					git(workspace, "for-each-ref", "--format=%(refname)", "refs/worktree/conducted/synced"),
				).toBe("");
			} finally {
				undo();
			}
		});
	}

	it("moves the branch onto the rewritten upstream and records the baseline", async () => {
		// The setup made the local tip and the rewritten upstream diverge.
		expect(git(workspace, "rev-parse", "HEAD")).toBe(localTip);
		expect(git(workspace, "rev-parse", "refs/remotes/origin/feat-b")).toBe(upstreamTip);
		expect(git(workspace, "reflog", "show", "--format=%H", "refs/remotes/origin/feat-b")).toContain(
			localTip,
		);

		const { service } = makeService();
		const result = await service.catchUpStackBranch(workspaceId, () => false);

		expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
		if (!result.ok || result.value.kind !== "rebased") return;
		const newTip = result.value.newTip;
		expect(newTip).toBe(upstreamTip);
		expect(git(workspace, "rev-parse", "HEAD")).toBe(upstreamTip);
		expect(git(workspace, "log", "--format=%s", "-1")).toBe("rewritten upstream");
		expect(git(workspace, "show", "--format=", "--name-only", "HEAD")).toBe("upstream.txt");
		const baseline = git(
			workspace,
			"for-each-ref",
			"--format=%(objectname)",
			"refs/worktree/conducted/synced",
		);
		expect(baseline).toBe(newTip);
	});

	it("leaves the branch alone on a second run because it is no longer diverged", async () => {
		const { service } = makeService();
		const before = git(workspace, "rev-parse", "HEAD");

		await service.catchUpStackBranch(workspaceId, () => false);

		expect(git(workspace, "rev-parse", "HEAD")).toBe(before);
	});
});
