/**
 * @feature PR-08 Graphite parent as the diff target and the Graphite checkout
 * Owns: tests that the git service reads the Graphite parent for the diff target, and that a
 * switch into a Graphite stack branch uses `gt checkout`.
 * Behaviour: services-map.md 3.8.1.
 * Test first: with a Graphite parent, the merge base is read against that local branch.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
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
