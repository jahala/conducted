/**
 * @feature GIT-06 Pull and push
 * Tests for push (upstream lookup, first push, no remote), pull latest from the target (fetch,
 * recheck, fast-forward, hand-off to the agent) and the per-action single flight.
 */
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
import { configPullFf, type GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import {
	firstPushRemoteBranch,
	GitService,
	PULL_UP_TO_DATE_MESSAGE,
	pullStrategy,
	pullUsesRebase,
	targetBranchName,
	upstreamBranchOn,
	type WorkspaceGitContext,
} from "./git.ts";

const workspaceId = "workspace-1" as WorkspaceId;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

type Handler = (
	command: GitCommand,
	options: GitRunOptions,
) => Result<ShellOutput> | Promise<Result<ShellOutput>>;

function fakeRunner(handler: Handler): { runner: GitRunner; calls: GitCommand[] } {
	const calls: GitCommand[] = [];
	const run = async (command: GitCommand, options: GitRunOptions) => {
		calls.push(command);
		return handler(command, options);
	};
	const runChecked = async (command: GitCommand, options: GitRunOptions) => {
		const result = await run(command, options);
		if (!result.ok) return result;
		const codes = command.okExitCodes ?? [0];
		return codes.includes(result.value.exitCode)
			? result
			: err(appError("git_failed", result.value.stderr.trim() || "git failed"));
	};
	const stdout = async (command: GitCommand, options: GitRunOptions) => {
		const result = await runChecked(command, options);
		return result.ok ? ok(result.value.stdout.trim()) : result;
	};
	return {
		runner: {
			run,
			runChecked,
			stdout,
			start: async () => {
				throw new Error("start is not used here");
			},
			withWorktreeLock: (_path, work) => work(),
			withWorktreeAndRepoLocks: (_path, _root, work) => work(),
		},
		calls,
	};
}

const context = (overrides: Partial<WorkspaceGitContext> = {}): WorkspaceGitContext => ({
	workspaceId,
	workspacePath: "/wt",
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feat",
	...overrides,
});

function makeService(
	runner: GitRunner,
	options: {
		contextOf?: (id: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
		instructions?: string[];
	} = {},
): GitService {
	const instructions = options.instructions ?? [];
	return new GitService({
		git: runner,
		cache: {} as never,
		contextOf: options.contextOf ?? (async () => ok(context())),
		agent: {
			sendInstruction: async (_id, text) => {
				instructions.push(text);
				return ok("session-1" as SessionId);
			},
		},
		now: () => 0,
		fs: {
			trash: async () => ok(undefined),
			readText: async () => err(appError("fs_not_found", "missing")),
			writeTextAtomic: async () => ok(undefined),
			mkdirp: async () => ok(undefined),
			stat: async () => err(appError("fs_not_found", "missing")),
			paths: { home: "", appData: "", temp: "", resources: "" },
		},
		renameWorkspaceBranch: async () => ok(undefined),
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
	});
}

const isConfigGet = (command: GitCommand, key: string): boolean =>
	command.args[0] === "config" && command.args[1] === "--get" && command.args[2] === key;

const configValue = (value: string): ShellOutput =>
	value.length === 0 ? output("", "", 1) : output(`${value}\n`);

describe("GIT-06 pull and push", () => {
	it("pushes to a known upstream without -u", async () => {
		const { runner, calls } = fakeRunner((command) => {
			if (command.args[0] === "rev-parse") return ok(output("origin/feat\n"));
			if (command.args[0] === "push") return ok(output(""));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner);

		const result = await service.push(workspaceId);

		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(2);
		expect(calls[1]?.args).toEqual(["push", "--", "origin", "HEAD:feat"]);
		for (const command of calls) {
			expect(command.args).not.toContain("--force");
			expect(command.args).not.toContain("-f");
		}
	});

	it("sets up the upstream on a first push and fetches the new remote-tracking ref", async () => {
		const { runner, calls } = fakeRunner((command) => {
			if (command.args[0] === "rev-parse") return ok(output("", "fatal: no upstream", 128));
			if (isConfigGet(command, "branch.feat.remote")) return ok(configValue("origin"));
			if (isConfigGet(command, "branch.feat.merge")) return ok(configValue("refs/heads/feat"));
			return ok(output(""));
		});
		const service = makeService(runner);

		const result = await service.push(workspaceId);

		expect(result.ok).toBe(true);
		expect(calls.map((command) => command.args)).toEqual([
			["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
			["config", "--get", "branch.feat.remote"],
			["config", "--get", "branch.feat.merge"],
			["push", "-u", "--", "origin", "HEAD:feat"],
			["config", "branch.feat.remote", "origin"],
			["config", "branch.feat.merge", "refs/heads/feat"],
			[
				"fetch",
				"--no-write-fetch-head",
				"--prune",
				"--",
				"origin",
				"+refs/heads/feat:refs/remotes/origin/feat",
			],
		]);
	});

	it("uses an already configured remote branch name on a first push", async () => {
		const { runner, calls } = fakeRunner((command) => {
			if (command.args[0] === "rev-parse") return ok(output("", "fatal: no upstream", 128));
			if (isConfigGet(command, "branch.feat.remote")) return ok(configValue("origin"));
			if (isConfigGet(command, "branch.feat.merge")) return ok(configValue("refs/heads/other"));
			return ok(output(""));
		});
		const service = makeService(runner);

		await service.push(workspaceId);

		const push = calls.find((command) => command.args[0] === "push");
		expect(push?.args).toEqual(["push", "-u", "--", "origin", "HEAD:other"]);
		const mergeConfig = calls.find(
			(command) => command.args[0] === "config" && command.args[1] === "branch.feat.merge",
		);
		expect(mergeConfig?.args).toEqual(["config", "branch.feat.merge", "refs/heads/other"]);
	});

	it("uses a plain push when there is no remote information", async () => {
		const { runner, calls } = fakeRunner((command) => {
			if (command.args[0] === "push") return ok(output(""));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, {
			contextOf: async () => ok(context({ remote: "", targetBranch: "" })),
		});

		const result = await service.push(workspaceId);

		expect(result.ok).toBe(true);
		expect(calls.map((command) => command.args)).toEqual([["push"]]);
	});

	it("runs one push for two calls at the same time", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let contexts = 0;
		const { runner, calls } = fakeRunner(async (command) => {
			if (command.args[0] === "rev-parse") {
				await gate;
				return ok(output("origin/feat\n"));
			}
			if (command.args[0] === "push") return ok(output(""));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, {
			contextOf: async () => {
				contexts += 1;
				return ok(context());
			},
		});

		const first = service.push(workspaceId);
		const second = service.push(workspaceId);
		release?.();
		const [a, b] = await Promise.all([first, second]);

		expect(a.ok && b.ok).toBe(true);
		expect(contexts).toBe(1);
		expect(calls.filter((command) => command.args[0] === "push")).toHaveLength(1);
	});

	it("hands a dirty tree to the agent instead of running git", async () => {
		const instructions: string[] = [];
		const { runner, calls } = fakeRunner((command) => {
			if (isConfigGet(command, "pull.rebase")) return ok(configValue("true"));
			if (isConfigGet(command, "pull.ff")) return ok(configValue(""));
			if (command.args[0] === "status") return ok(output(" M src/a.ts\n"));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, { instructions });

		const result = await service.pull(workspaceId);

		expect(result.ok).toBe(true);
		expect(instructions).toHaveLength(1);
		expect(instructions[0]).toContain("Review the uncommitted changes");
		expect(instructions[0]).toContain("Rebase this branch onto `origin/main`");
		expect(instructions[0]).toContain("--force-with-lease");
		expect(calls.some((command) => command.args[0] === "fetch")).toBe(false);
		expect(calls.some((command) => command.args[0] === "merge")).toBe(false);
	});

	it("fetches, rechecks under the lock and fast-forwards a clean branch", async () => {
		const { runner, calls } = fakeRunner((command) => {
			if (isConfigGet(command, "pull.rebase")) return ok(configValue(""));
			if (isConfigGet(command, "pull.ff")) return ok(configValue(""));
			if (command.args[0] === "status") return ok(output(""));
			if (command.args[0] === "fetch") return ok(output(""));
			if (command.args[0] === "rev-list") return ok(output("0\t2\n"));
			if (command.args[0] === "merge") return ok(output(""));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner);

		const result = await service.pull(workspaceId);

		expect(result.ok).toBe(true);
		const fetchIndex = calls.findIndex((command) => command.args[0] === "fetch");
		const mergeIndex = calls.findIndex((command) => command.args[0] === "merge");
		expect(fetchIndex).toBeGreaterThan(-1);
		expect(mergeIndex).toBeGreaterThan(fetchIndex);
		expect(calls[mergeIndex]?.args).toEqual(["merge", "--ff-only", "refs/remotes/origin/main"]);
		expect(calls.filter((command) => command.args[0] === "status")).toHaveLength(2);
	});

	it("rechecks the tree under the lock and hands a newly dirty tree to the agent", async () => {
		const instructions: string[] = [];
		let statusReads = 0;
		const { runner, calls } = fakeRunner((command) => {
			if (isConfigGet(command, "pull.rebase")) return ok(configValue(""));
			if (isConfigGet(command, "pull.ff")) return ok(configValue(""));
			if (command.args[0] === "status") {
				statusReads += 1;
				return ok(output(statusReads === 1 ? "" : " M late.ts\n"));
			}
			if (command.args[0] === "fetch") return ok(output(""));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, { instructions });

		const result = await service.pull(workspaceId);

		expect(result.ok).toBe(true);
		expect(instructions).toHaveLength(1);
		expect(calls.some((command) => command.args[0] === "merge")).toBe(false);
		expect(calls.some((command) => command.args[0] === "rev-list")).toBe(false);
	});

	it("does nothing new when the branch is up to date", async () => {
		const instructions: string[] = [];
		const { runner, calls } = fakeRunner((command) => {
			if (isConfigGet(command, "pull.rebase")) return ok(configValue(""));
			if (isConfigGet(command, "pull.ff")) return ok(configValue(""));
			if (command.args[0] === "status") return ok(output(""));
			if (command.args[0] === "fetch") return ok(output(""));
			if (command.args[0] === "rev-list") return ok(output("0\t0\n"));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, { instructions });

		const result = await service.pull(workspaceId);

		expect(result.ok).toBe(true);
		expect(instructions).toHaveLength(0);
		expect(calls.some((command) => command.args[0] === "merge")).toBe(false);
		expect(PULL_UP_TO_DATE_MESSAGE).toBe("Pulled latest changes. You're up to date!");
	});

	it("hands a diverged branch to the agent with the configured merge strategy", async () => {
		const instructions: string[] = [];
		const { runner, calls } = fakeRunner((command) => {
			if (isConfigGet(command, "pull.rebase")) return ok(configValue("false"));
			if (isConfigGet(command, "pull.ff")) return ok(configValue(""));
			if (command.args[0] === "status") return ok(output(""));
			if (command.args[0] === "fetch") return ok(output(""));
			if (command.args[0] === "rev-list") return ok(output("1\t2\n"));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, { instructions });

		const result = await service.pull(workspaceId);

		expect(result.ok).toBe(true);
		expect(instructions).toHaveLength(1);
		expect(instructions[0]).toContain("Merge `origin/main` into this branch");
		expect(calls.some((command) => command.args[0] === "merge")).toBe(false);
	});

	it("honours pull.ff=only by refusing to turn a diverged pull into an agent merge", async () => {
		const instructions: string[] = [];
		const { runner } = fakeRunner((command) => {
			if (isConfigGet(command, "pull.rebase")) return ok(configValue(""));
			if (isConfigGet(command, "pull.ff")) return ok(configValue("only"));
			if (command.args[0] === "status") return ok(output(""));
			if (command.args[0] === "fetch") return ok(output(""));
			if (command.args[0] === "rev-list") return ok(output("1\t2\n"));
			if (command.args[0] === "merge") {
				return ok(output("", "fatal: Not possible to fast-forward, aborting.", 128));
			}
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, { instructions });

		const result = await service.pull(workspaceId);

		expect(result.ok).toBe(false);
		expect(instructions).toHaveLength(0);
	});

	it("uses a plain pull when there is no target", async () => {
		const { runner, calls } = fakeRunner((command) => {
			if (command.args[0] === "pull") return ok(output(""));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, {
			contextOf: async () => ok(context({ targetBranch: "" })),
		});

		const result = await service.pull(workspaceId);

		expect(result.ok).toBe(true);
		expect(calls.map((command) => command.args)).toEqual([["pull"]]);
	});

	it("runs one pull for two calls at the same time", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let contexts = 0;
		const { runner } = fakeRunner(async (command) => {
			if (isConfigGet(command, "pull.rebase")) return ok(configValue(""));
			if (isConfigGet(command, "pull.ff")) return ok(configValue(""));
			if (command.args[0] === "status") return ok(output(""));
			if (command.args[0] === "fetch") {
				await gate;
				return ok(output(""));
			}
			if (command.args[0] === "rev-list") return ok(output("0\t0\n"));
			return err(appError("git_failed", `unexpected: ${command.args.join(" ")}`));
		});
		const service = makeService(runner, {
			contextOf: async () => {
				contexts += 1;
				return ok(context());
			},
		});

		const first = service.pull(workspaceId);
		const second = service.pull(workspaceId);
		release?.();
		const [a, b] = await Promise.all([first, second]);

		expect(a.ok && b.ok).toBe(true);
		expect(contexts).toBe(1);
	});

	it("reads the user's pull settings and names the remote-target parts", () => {
		expect(configPullFf().args).toEqual(["config", "--get", "pull.ff"]);
		expect(pullUsesRebase("true")).toBe(true);
		expect(pullUsesRebase("merges")).toBe(true);
		expect(pullUsesRebase("false")).toBe(false);
		expect(pullUsesRebase("")).toBe(false);
		expect(pullStrategy("true", "")).toBe("rebase");
		expect(pullStrategy("", "")).toBe("merge");
		expect(pullStrategy("true", "only")).toBe("ff_only");
		expect(targetBranchName("origin/main", "origin")).toBe("main");
		expect(targetBranchName("refs/remotes/origin/main", "origin")).toBe("main");
		expect(upstreamBranchOn("origin/feat", "origin")).toBe("feat");
		expect(upstreamBranchOn("upstream/feat", "origin")).toBeNull();
		expect(
			firstPushRemoteBranch({
				branch: "feat",
				remote: "origin",
				configuredRemote: "origin",
				configuredMerge: "refs/heads/other",
			}),
		).toBe("other");
	});
});
