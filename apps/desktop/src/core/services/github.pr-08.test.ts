// @vitest-environment node
/**
 * @feature PR-08 GitHub stacks: reading a pull request's stack, the stack sync and the stack merge
 * Owns: tests for the native stack read, the optional `stackEntry` retry, the stack merge, and the
 * extension error both stack commands share and the sync's abort errors.
 * Behaviour: services-map.md 3.8.2.
 * Test first: a stack member list comes back from trunk up with the workspace branch marked as
 * current.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import type { PrWorkspaceContext } from "./github.ts";
import { GithubService } from "./github.ts";
import { GraphiteService } from "./graphite.ts";

const workspaceId = "ws-1" as WorkspaceId;

const settingOff = <T>(_key: string): T => false as unknown as T;

const context: PrWorkspaceContext = {
	workspaceId,
	workspacePath: "/wt",
	branch: "feat-b",
	remote: "origin",
	prNumber: 12,
	targetBranch: "origin/main",
};

function makeService(
	git: FakeGitRunner,
	options: {
		prNumber?: number | null;
		setting?: <T>(key: string) => T;
		graphite?: GraphiteService;
	} = {},
): GithubService {
	return new GithubService({
		git,
		agent: {} as never,
		contextOf: async () =>
			ok({
				...context,
				prNumber: options.prNumber === undefined ? context.prNumber : options.prNumber,
			}),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: "/tmp",
		...(options.setting === undefined ? {} : { setting: options.setting }),
		...(options.graphite === undefined ? {} : { graphite: options.graphite }),
	});
}

const stackAnswer = (entry: unknown): string =>
	JSON.stringify({ data: { repository: { pullRequest: { number: 12, stackEntry: entry } } } });

const membersAnswer = (): string =>
	JSON.stringify({
		pull_requests: [
			{
				number: 10,
				title: "Add the parser",
				state: "OPEN",
				draft: false,
				merged_at: null,
				head: { ref: "feat-a" },
			},
			{
				number: 11,
				title: "Use the parser",
				state: "OPEN",
				draft: false,
				merged_at: null,
				head: { ref: "feat-b" },
			},
			{
				number: 12,
				title: "Document the parser",
				state: "OPEN",
				draft: true,
				merged_at: null,
				head: { ref: "feat-c" },
			},
		],
	});

const stackEntry = {
	position: 2,
	stack: { number: 5, size: 3, baseRefName: "main" },
};

function stackHandler(command: {
	program: string;
	args: readonly string[];
}): ReturnType<typeof gitOutput> {
	if (command.program === "git") return gitOutput("git@github.com:o/r.git\n");
	if (command.args.includes("graphql")) {
		if (command.args.some((arg) => arg.includes("stackEntry"))) {
			return gitOutput("", "GraphQL: Field 'stackEntry' doesn't exist on type 'PullRequest'", 1);
		}
		return gitOutput(stackAnswer(null));
	}
	if (command.args[0] === "api" && command.args[1]?.includes("/stacks/5") === true) {
		return gitOutput(membersAnswer());
	}
	return gitOutput();
}

const graphqlCalls = (git: FakeGitRunner) =>
	git.commands.filter((command) => command.program === "gh" && command.args.includes("graphql"));

describe("PR-08 GitHub stack read", () => {
	it("reads the stack from trunk up with the workspace branch marked as current", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:o/r.git\n");
			if (command.args.includes("graphql")) return gitOutput(stackAnswer(stackEntry));
			if (command.args[1]?.includes("/stacks/5") === true) return gitOutput(membersAnswer());
			return gitOutput();
		});
		const service = makeService(git);

		const read = await service.readStack(workspaceId);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value.map((entry) => entry.branch)).toEqual(["feat-a", "feat-b", "feat-c"]);
		expect(read.value.map((entry) => entry.isCurrent)).toEqual([false, true, false]);
		expect(read.value[2]?.state).toBe("draft");
		expect(read.value.map((entry) => entry.needsRestack)).toEqual([false, false, false]);
	});

	it("marks the entry Graphite says needs a restack", async () => {
		const graphite = new GraphiteService({
			git: new FakeGitRunner((command) => {
				if (command.args[0] === "--version") return gitOutput("gt 1.0.0");
				return gitOutput(
					JSON.stringify({
						"feat-b": { parents: [{ ref: "feat-a" }] },
						"feat-c": { needs_restack: true, parents: [{ ref: "feat-b" }] },
					}),
				);
			}),
			setting: <T>(_key: string): T => false as unknown as T,
			now: () => 1_000,
		});
		// The context has no main worktree, so the stack read keys Graphite by the workspace folder.
		expect(await graphite.refresh("/wt")).toEqual(ok(undefined));
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:o/r.git\n");
			if (command.args.includes("graphql")) return gitOutput(stackAnswer(stackEntry));
			if (command.args[1]?.includes("/stacks/5") === true) return gitOutput(membersAnswer());
			return gitOutput();
		});
		const service = makeService(git, { graphite });

		const read = await service.readStack(workspaceId);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value.map((entry) => entry.needsRestack)).toEqual([false, false, true]);
	});

	it("returns an empty answer when the pull request is not in a stack", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:o/r.git\n");
			if (command.args.includes("graphql")) return gitOutput(stackAnswer(null));
			return gitOutput();
		});
		const service = makeService(git);

		expect(await service.readStack(workspaceId)).toEqual(ok([]));
	});

	it("retries without the optional stackEntry field and remembers that repository", async () => {
		const git = new FakeGitRunner(stackHandler);
		const service = makeService(git);

		expect(await service.readStack(workspaceId)).toEqual(ok([]));
		expect(graphqlCalls(git)).toHaveLength(2);
		expect(graphqlCalls(git)[1]?.args.some((arg) => arg.includes("stackEntry"))).toBe(false);

		// The second read goes straight to the query this host already accepted.
		expect(await service.readStack(workspaceId)).toEqual(ok([]));
		expect(graphqlCalls(git)).toHaveLength(3);
		expect(graphqlCalls(git)[2]?.args.some((arg) => arg.includes("stackEntry"))).toBe(false);
	});

	it("returns an empty answer when stacked pull requests are turned off", async () => {
		const git = new FakeGitRunner(() => gitOutput());
		const service = makeService(git, { setting: settingOff });

		expect(await service.readStack(workspaceId)).toEqual(ok([]));
		expect(git.commands).toHaveLength(0);
	});
});

describe("PR-08 GitHub stack merge", () => {
	it("merges the stack with the repository's first allowed method", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git" && command.args.includes("--git-common-dir")) {
				return gitOutput("/wt/.git\n");
			}
			if (command.program === "gh" && command.args.includes("graphql")) {
				return gitOutput("[true,false,false]\n");
			}
			return gitOutput();
		});
		const service = makeService(git);

		expect(await service.mergeStack(workspaceId)).toEqual(ok(undefined));
		const merge = git.commands.find(
			(command) =>
				command.program === "gh" && command.args[0] === "stack" && command.args[1] === "merge",
		);
		expect(merge?.args).toEqual(["stack", "merge", "12", "--yes", "--squash"]);
	});

	it("refuses a stack merge while stacked pull requests are turned off", async () => {
		const git = new FakeGitRunner(() => gitOutput());
		const service = makeService(git, { setting: settingOff });

		const merged = await service.mergeStack(workspaceId);
		expect(merged.ok).toBe(false);
		if (merged.ok) return;
		expect(merged.error.code).toBe("github_stacks_disabled");
		expect(git.commands).toHaveLength(0);
	});

	it("says how to install the extension when gh does not know the stack command", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git" && command.args.includes("--git-common-dir")) {
				return gitOutput("/wt/.git\n");
			}
			if (command.program === "gh" && command.args.includes("graphql")) {
				return gitOutput("[true,false,false]\n");
			}
			if (command.program === "gh" && command.args[0] === "stack") {
				return gitOutput("", 'unknown command "stack" for "gh"', 1);
			}
			return gitOutput();
		});
		const service = makeService(git);

		const merged = await service.mergeStack(workspaceId);
		expect(merged.ok).toBe(false);
		if (merged.ok) return;
		expect(merged.error.code).toBe("github_stack_extension_missing");
		expect(merged.error.message).toBe(
			"Merging a stack needs GitHub's stack extension. Install it with `gh extension install github/gh-stack`.",
		);
	});
});

describe("PR-08 GitHub stack sync", () => {
	it("says how to install the extension when gh does not know the stack command", async () => {
		const git = new FakeGitRunner(() => gitOutput("", 'unknown command "stack" for "gh"', 1));
		const service = makeService(git);

		const sync = await service.syncStack(workspaceId);
		expect(sync.ok).toBe(false);
		if (sync.ok) return;
		expect(sync.error.code).toBe("github_stack_extension_missing");
		expect(sync.error.message).toBe(
			"Syncing a stack needs GitHub's stack extension. Install it with `gh extension install github/gh-stack`.",
		);
	});

	it("treats a cross mark as an aborted sync", async () => {
		const git = new FakeGitRunner(() => gitOutput("✓ synced\n✗ one branch needs attention\n"));
		const service = makeService(git);

		const sync = await service.syncStack(workspaceId);
		expect(sync.ok).toBe(false);
		if (sync.ok) return;
		expect(sync.error.code).toBe("github_stack_sync_aborted");
	});

	it("succeeds when gh syncs the stack without a cross mark", async () => {
		const git = new FakeGitRunner(() => gitOutput("✓ synced\n"));
		const service = makeService(git);

		expect(await service.syncStack(workspaceId)).toEqual(ok(undefined));
	});

	it("refuses when stacked pull requests are turned off", async () => {
		const git = new FakeGitRunner(() => gitOutput());
		const service = makeService(git, { setting: settingOff });

		const sync = await service.syncStack(workspaceId);
		expect(sync.ok).toBe(false);
		if (sync.ok) return;
		expect(sync.error.code).toBe("github_stacks_disabled");
		expect(git.commands).toHaveLength(0);
	});
});
