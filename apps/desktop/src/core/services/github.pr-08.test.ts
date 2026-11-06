// @vitest-environment node
/**
 * @feature PR-08 GitHub stacks: reading a pull request's stack, the stack sync and the stack merge
 * Owns: tests for the native stack read, each entry's readiness and commit ids, the optional
 * `stackEntry` retry, the stack merge, the locks the stack sync holds, and the extension error both
 * stack commands share and the sync's abort errors.
 * Behaviour: services-map.md 3.8.2, 3.0.3 (`gh stack sync` runs under the worktree and repo locks).
 * Test first: a stack member list comes back from trunk up with the workspace branch marked as
 * current.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import { repoLockKey } from "../git/locks.ts";
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
		repoRootPath?: string;
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
				...(options.repoRootPath === undefined ? {} : { repoRootPath: options.repoRootPath }),
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
				head: { ref: "feat-a", sha: "a1" },
				base: { ref: "main", sha: "m0" },
			},
			{
				number: 11,
				title: "Use the parser",
				state: "OPEN",
				draft: false,
				merged_at: null,
				head: { ref: "feat-b", sha: "b1" },
				base: { ref: "feat-a", sha: "a1" },
			},
			{
				number: 12,
				title: "Document the parser",
				state: "OPEN",
				draft: true,
				merged_at: null,
				head: { ref: "feat-c", sha: "c1" },
				base: { ref: "feat-b", sha: "b1" },
			},
		],
	});

const stackEntry = {
	position: 2,
	stack: { number: 5, size: 3, baseRefName: "main" },
};

/** GitHub's answer to the readiness query: one aliased pull request per stack member. */
const readinessAnswer = (statuses: Record<number, string>): string =>
	JSON.stringify({
		data: {
			repository: Object.fromEntries(
				Object.entries(statuses).map(([number, status], index) => [
					`pr${index}`,
					{ number: Number(number), mergeStateStatus: status },
				]),
			),
		},
	});

const isReadinessQuery = (args: readonly string[]): boolean =>
	args.includes("graphql") && args.some((arg) => arg.includes("mergeStateStatus"));

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

	it("reads each entry's readiness and commit ids", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:o/r.git\n");
			if (isReadinessQuery(command.args)) {
				return gitOutput(readinessAnswer({ 10: "CLEAN", 11: "BLOCKED", 12: "DRAFT" }));
			}
			if (command.args.includes("graphql")) return gitOutput(stackAnswer(stackEntry));
			if (command.args[1]?.includes("/stacks/5") === true) return gitOutput(membersAnswer());
			return gitOutput();
		});
		const service = makeService(git);

		const read = await service.readStack(workspaceId);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value.map((entry) => entry.mergeStateStatus)).toEqual([
			"CLEAN",
			"BLOCKED",
			"DRAFT",
		]);
		expect(read.value.map((entry) => entry.headSha)).toEqual(["a1", "b1", "c1"]);
		expect(read.value.map((entry) => entry.baseSha)).toEqual(["m0", "a1", "b1"]);
		// Each pull request number reaches GitHub as a variable, never written into the query.
		const query = git.commands.find((command) => isReadinessQuery(command.args));
		expect(query?.args).toEqual(
			expect.arrayContaining(["-F", "pr0=10", "-F", "pr1=11", "-F", "pr2=12"]),
		);
	});

	it("keeps the stack with unknown readiness when the readiness read fails", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:o/r.git\n");
			if (isReadinessQuery(command.args)) return gitOutput("", "HTTP 502", 1);
			if (command.args.includes("graphql")) return gitOutput(stackAnswer(stackEntry));
			if (command.args[1]?.includes("/stacks/5") === true) return gitOutput(membersAnswer());
			return gitOutput();
		});
		const service = makeService(git);

		const read = await service.readStack(workspaceId);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value.map((entry) => entry.number)).toEqual([10, 11, 12]);
		expect(read.value.map((entry) => entry.mergeStateStatus)).toEqual([null, null, null]);
	});

	it("refuses a stack member without its head commit", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git") return gitOutput("git@github.com:o/r.git\n");
			if (command.args.includes("graphql")) return gitOutput(stackAnswer(stackEntry));
			if (command.args[1]?.includes("/stacks/5") === true) {
				return gitOutput(
					JSON.stringify({
						pull_requests: [
							{
								number: 10,
								title: "t",
								state: "OPEN",
								head: { ref: "feat-a" },
								base: { ref: "main", sha: "m0" },
							},
						],
					}),
				);
			}
			return gitOutput();
		});
		const service = makeService(git);

		const read = await service.readStack(workspaceId);
		expect(read.ok).toBe(false);
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

describe("PR-08 GitHub stack members for a range", () => {
	const answer = (command: { program: string; args: readonly string[] }) => {
		if (command.program === "git") return gitOutput("git@github.com:o/r.git\n");
		if (command.args.includes("graphql")) return gitOutput(stackAnswer(stackEntry));
		if (command.args[1]?.includes("/stacks/5") === true) return gitOutput(membersAnswer());
		return gitOutput();
	};
	const membersReads = (git: FakeGitRunner) =>
		git.commands.filter((command) => command.args[1]?.includes("/stacks/5") === true).length;

	it("hands the range the stack the last read found, with each base branch, without asking GitHub again", async () => {
		const git = new FakeGitRunner(answer);
		const service = makeService(git);
		const read = await service.readStack(workspaceId);
		expect(read.ok).toBe(true);
		// The stack view's entries do not carry the base branch; the range's members do.
		expect(read.ok && read.value.some((entry) => "baseBranch" in entry)).toBe(false);

		const members = await service.stackMembersOf(workspaceId);

		expect(membersReads(git)).toBe(1);
		expect(members.ok && members.value.map((member) => [member.number, member.baseBranch])).toEqual(
			[
				[10, "main"],
				[11, "feat-a"],
				[12, "feat-b"],
			],
		);
	});

	it("reads the stack when nothing has read it yet", async () => {
		const git = new FakeGitRunner(answer);
		const service = makeService(git);

		const members = await service.stackMembersOf(workspaceId);

		expect(membersReads(git)).toBe(1);
		expect(members.ok && members.value.map((member) => member.headSha)).toEqual(["a1", "b1", "c1"]);
	});

	it("forgets the stack when a later read finds the pull request outside a stack", async () => {
		let inStack = true;
		const git = new FakeGitRunner((command) => {
			if (
				command.args.includes("graphql") &&
				command.args.some((arg) => arg.includes("stackEntry"))
			) {
				return gitOutput(stackAnswer(inStack ? stackEntry : null));
			}
			return answer(command);
		});
		const service = makeService(git);
		await service.readStack(workspaceId);
		inStack = false;
		await service.readStack(workspaceId);

		const members = await service.stackMembersOf(workspaceId);

		expect(members).toEqual(ok([]));
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
		const service = makeService(git, { repoRootPath: "/repo" });

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
		const service = makeService(git, { repoRootPath: "/repo" });

		const sync = await service.syncStack(workspaceId);
		expect(sync.ok).toBe(false);
		if (sync.ok) return;
		expect(sync.error.code).toBe("github_stack_sync_aborted");
	});

	it("succeeds when gh syncs the stack without a cross mark", async () => {
		const git = new FakeGitRunner(() => gitOutput("✓ synced\n"));
		const service = makeService(git, { repoRootPath: "/repo" });

		expect(await service.syncStack(workspaceId)).toEqual(ok(undefined));
	});

	it("runs under the worktree lock and then the repo lock", async () => {
		const git = new FakeGitRunner(() => gitOutput("✓ synced\n"));
		const service = makeService(git, { repoRootPath: "/repo" });
		let release = () => {};
		const held = git.locks.run(
			repoLockKey("/repo"),
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);

		const sync = service.syncStack(workspaceId);
		await vi.waitFor(() => expect(git.repoLocks).toEqual(["/repo"]));
		expect(git.worktreeLocks).toEqual(["/wt"]);
		const syncs = () => git.commands.filter((command) => command.args[0] === "stack");
		expect(syncs()).toHaveLength(0);

		release();
		await held;
		expect(await sync).toEqual(ok(undefined));
		expect(syncs()).toHaveLength(1);
	});

	it("refuses when the repository's main worktree is not known", async () => {
		const git = new FakeGitRunner(() => gitOutput("✓ synced\n"));
		const service = makeService(git);

		const sync = await service.syncStack(workspaceId);
		expect(sync.ok).toBe(false);
		expect(git.commands).toHaveLength(0);
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
