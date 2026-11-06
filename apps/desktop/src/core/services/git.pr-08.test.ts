/**
 * @feature PR-08 Graphite parent as the diff target and the Graphite checkout; PR and stack range
 * diffs
 * Owns: tests that the git service reads the Graphite parent for the diff target, that a switch
 * into a Graphite stack branch uses `gt checkout`, and that a range scope compares the chosen run
 * of stack pull requests, fetching missing commits at most once a minute.
 * Behaviour: services-map.md 3.8.1, 3.4.1 and 3.4.5.
 * Test first: with a Graphite parent, the merge base is read against that local branch.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import type { StackRangeMember } from "../git/stack-range.ts";
import { GitService, type GraphitePort, type WorkspaceGitContext } from "./git.ts";

const workspaceId = "workspace-pr-08" as WorkspaceId;

const context: WorkspaceGitContext = {
	workspaceId,
	workspacePath: "/wt",
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feat",
};

function scriptedRunner(
	onMergeBase: (args: readonly string[]) => void,
	extra?: (command: GitCommand) => Result<ShellOutput> | null,
): GitRunner {
	return new FakeGitRunner((command, options: GitRunOptions) => {
		const extraAnswer = extra?.(command);
		if (extraAnswer !== null && extraAnswer !== undefined) return extraAnswer;
		const [first, second] = command.args;
		if (first === "branch" && second === "--show-current") return gitOutput("feat\n");
		if (first === "rev-parse" && second === "--git-path") {
			return gitOutput(`/git/${command.args.at(-1)}\n`);
		}
		if (first === "merge-base") {
			onMergeBase(command.args);
			return gitOutput("mb\n");
		}
		if (first === "diff" && command.args.includes("--name-status")) {
			return gitOutput(`M\t${options.cwd}.ts\n`);
		}
		if (first === "diff" && command.args.includes("--numstat")) {
			return gitOutput(`1\t0\t${options.cwd}.ts\n`);
		}
		if (first === "status" && second === "--porcelain") return gitOutput("");
		if (first === "ls-files") return gitOutput("");
		if (first === "rev-parse" && second === "HEAD") return gitOutput("", "fatal: no upstream", 128);
		if (first === "rev-list" && second === "--count") return gitOutput("0\n");
		if (first === "log") return gitOutput("");
		if (command.program === "stat") return gitOutput("", "", 1);
		return err(appError("git_failed", `unexpected command: ${command.args.join(" ")}`));
	});
}

function makeService(runner: GitRunner, graphite: GraphitePort): GitService {
	return new GitService({
		git: runner,
		graphite,
		contextOf: async () => ok(context),
		agent: {} as never,
		renameWorkspaceBranch: async () => ok(undefined),
		now: () => Date.now(),
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

const graphite = (over: Partial<GraphitePort> = {}): GraphitePort => ({
	parentBranchOf: () => "feature/parent",
	containsBranch: () => false,
	checkout: async () => ok(undefined),
	...over,
});

describe("PR-08 Graphite diff target", () => {
	it("reads the merge base against the Graphite parent", async () => {
		const mergeBases: string[][] = [];
		const service = makeService(
			scriptedRunner((args) => {
				mergeBases.push([...args]);
			}),
			graphite(),
		);

		await service.refresh(workspaceId, "full");

		expect(mergeBases[0]).toEqual(["merge-base", "feature/parent", "feat"]);
	});

	it("falls back to the stored target when Graphite reports no parent", async () => {
		const mergeBases: string[][] = [];
		const service = makeService(
			scriptedRunner((args) => {
				mergeBases.push([...args]);
			}),
			graphite({ parentBranchOf: () => null }),
		);

		await service.refresh(workspaceId, "full");

		expect(mergeBases[0]).toEqual(["merge-base", "refs/remotes/origin/main", "feat"]);
	});
});

describe("PR-08 Graphite checkout", () => {
	it("switches to a Graphite stack branch with gt checkout", async () => {
		const checkout = vi.fn(async () => ok(undefined));
		const runner = scriptedRunner(
			() => {},
			(command) => {
				if (command.args[0] === "symbolic-ref") return gitOutput("refs/heads/feature/one\n");
				if (command.args.includes("--show-current") || command.args[0] === "branch") {
					return gitOutput("feature/one\n");
				}
				if (command.args[0] === "rev-parse" && command.args.includes("@{u}")) {
					return gitOutput("abc\ndef\n");
				}
				if (command.args[0] === "rev-parse" && command.args[1] === "HEAD")
					return gitOutput("abc\n");
				if (command.args[0] === "merge-base") return gitOutput("mb\n");
				if (command.args[0] === "diff" && command.args.includes("--name-status")) {
					return gitOutput("");
				}
				if (command.args[0] === "diff" && command.args.includes("--numstat")) return gitOutput("");
				if (command.args[0] === "status" && command.args[1] === "--porcelain") return gitOutput("");
				if (command.args[0] === "ls-files") return gitOutput("");
				if (command.args[0] === "rev-list" && command.args.includes("--left-right")) {
					return gitOutput("0\t0\n");
				}
				if (command.args[0] === "rev-list") return gitOutput("0\n");
				return null;
			},
		);
		const service = makeService(runner, graphite({ containsBranch: () => true, checkout }));

		expect(await service.switchBranch(workspaceId, "feature/one")).toEqual(ok(undefined));
		expect(checkout).toHaveBeenCalledWith("/wt", "feature/one");
		const plainCheckouts = (runner as FakeGitRunner).commands.filter(
			(command) => command.program === "git" && command.args[0] === "checkout",
		);
		expect(plainCheckouts).toHaveLength(0);
	});
});

const M0 = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

/** The stack #10 (feat-a), #11 (feat, checked out) and #12 (feat-c), from trunk up. */
const stackMembers: StackRangeMember[] = [
	{ number: 10, branch: "feat-a", state: "open", headSha: A, baseSha: M0, baseBranch: "main" },
	{ number: 11, branch: "feat", state: "open", headSha: B, baseSha: A, baseBranch: "feat-a" },
	{ number: 12, branch: "feat-c", state: "draft", headSha: C, baseSha: B, baseBranch: "feat" },
];

function rangeService(options: {
	missing?: Set<string>;
	fetchFails?: boolean;
	now?: () => number;
}): { service: GitService; runner: FakeGitRunner } {
	const missing = options.missing ?? new Set<string>();
	const runner = new FakeGitRunner((command) => {
		const [first, second] = command.args;
		if (first === "rev-parse" && second === "--verify") {
			const oid = (command.args.at(-1) ?? "").replace(/\^0$/, "");
			return gitOutput(missing.has(oid) ? "" : `${oid}\n`, "", missing.has(oid) ? 1 : 0);
		}
		if (first === "merge-base") {
			const [, base, head] = command.args;
			if (base === "refs/remotes/origin/main") return gitOutput("branch-base\n");
			return gitOutput(`from-${base?.slice(0, 1)}${head?.slice(0, 1)}\n`);
		}
		if (first === "fetch") {
			return options.fetchFails === true
				? gitOutput("", "fatal: couldn't find remote ref feat-c", 128)
				: gitOutput("");
		}
		if (first === "diff" && command.args.includes("--name-status")) {
			return gitOutput("M\tsrc/range.ts\n");
		}
		if (first === "diff" && command.args.includes("--numstat")) {
			return gitOutput("2\t1\tsrc/range.ts\n");
		}
		return err(appError("git_failed", `unexpected command: ${command.args.join(" ")}`));
	});
	const service = new GitService({
		git: runner,
		graphite: graphite({ parentBranchOf: () => null }),
		contextOf: async () => ok(context),
		stackOf: async () => ok(stackMembers),
		agent: {} as never,
		renameWorkspaceBranch: async () => ok(undefined),
		now: options.now ?? (() => 0),
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
	return { service, runner };
}

const fetches = (runner: FakeGitRunner) =>
	runner.commands.filter((command) => command.args[0] === "fetch").map((command) => command.args);

describe("PR-08 range diff scope", () => {
	it("compares one pull request from its merge base to its head", async () => {
		const { service } = rangeService({});

		const resolved = await service.resolveScope(workspaceId, { kind: "range", prNumbers: [10] });

		// merge-base of #10's base (M0) and head (A).
		expect(resolved).toEqual(ok({ cwd: "/wt", from: "from-0a", to: A }));
	});

	it("compares a run up to the checked-out pull request against the working tree", async () => {
		const { service } = rangeService({});

		const resolved = await service.resolveScope(workspaceId, {
			kind: "range",
			prNumbers: [10, 11],
		});

		expect(resolved).toEqual(ok({ cwd: "/wt", from: "from-0a", to: null }));
	});

	it("shows the branch's own changes when only the checked-out pull request is chosen", async () => {
		const { service } = rangeService({});

		const resolved = await service.resolveScope(workspaceId, { kind: "range", prNumbers: [11] });

		expect(resolved).toEqual(ok({ cwd: "/wt", from: "branch-base", to: null }));
	});

	it("refuses pull requests that are not next to each other", async () => {
		const { service } = rangeService({});

		const resolved = await service.resolveScope(workspaceId, {
			kind: "range",
			prNumbers: [10, 12],
		});

		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.error.code).toBe("stack_range_not_adjacent");
		expect(resolved.error.message).toBe("Select adjacent PRs to see their changes");
	});

	it("lists the files of the range with git diff between the two commits", async () => {
		const { service, runner } = rangeService({});

		const files = await service.changedFiles(workspaceId, { kind: "range", prNumbers: [12] });

		expect(files.ok && files.value.map((file) => file.path)).toEqual(["src/range.ts"]);
		const diff = runner.commands.find(
			(command) => command.args[0] === "diff" && command.args.includes("--name-status"),
		);
		// #12 is based on #11's head (B), so the range runs from merge-base(B, C) to C.
		expect(diff?.args.slice(-2)).toEqual(["from-bc", C]);
	});

	it("fetches a missing head by branch at most once a minute and names the pull request it cannot show", async () => {
		let now = 1_000;
		const { service, runner } = rangeService({
			missing: new Set([C]),
			fetchFails: true,
			now: () => now,
		});

		const first = await service.resolveScope(workspaceId, { kind: "range", prNumbers: [12] });

		expect(fetches(runner)).toEqual([
			["fetch", "--no-write-fetch-head", "--prune", "--", "origin", "feat-c"],
		]);
		expect(first.ok).toBe(false);
		if (first.ok) return;
		expect(first.error.code).toBe("stack_range_unavailable");
		expect(first.error.message).toBe("Can't show #12's changes");
		// The failed fetch travels with the error instead of being dropped.
		expect((first.error.cause as { code?: string } | undefined)?.code).toBe("git_failed");

		now += 30_000;
		await service.resolveScope(workspaceId, { kind: "range", prNumbers: [12] });
		expect(fetches(runner)).toHaveLength(1);

		now += 30_000;
		await service.resolveScope(workspaceId, { kind: "range", prNumbers: [12] });
		expect(fetches(runner)).toHaveLength(2);
	});
});
