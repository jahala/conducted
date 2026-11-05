import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import {
	createRefreshLimiter,
	GIT_POLL_INTERVAL_MS,
	GitService,
	type WorkspaceGitContext,
} from "./git.ts";

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

function fakeRunner(
	handler: (command: GitCommand, options: GitRunOptions) => Result<ShellOutput>,
): GitRunner {
	return new FakeGitRunner(handler);
}

const fileIn = (cwd: string): string => (cwd === "/old" ? "old" : "new");

function pollRunner(branch = "feat"): { runner: GitRunner; branchReads: () => number } {
	let reads = 0;
	const runner = fakeRunner((command, options) => {
		if (command.program === "stat") {
			const path = command.args.at(-1) ?? "";
			return ok(output("", "", path.startsWith("/git/") ? 1 : 0));
		}
		const [first, second] = command.args;
		if (first === "branch" && second === "--show-current") {
			reads += 1;
			return ok(output(`${branch}\n`));
		}
		if (first === "rev-parse" && second === "--git-path") {
			return ok(output(`/git/${command.args.at(-1)}\n`));
		}
		if (first === "merge-base") return ok(output("mb\n"));
		if (first === "diff" && command.args.includes("--name-status")) {
			return ok(output(`M\t${fileIn(options.cwd)}.ts\n`));
		}
		if (first === "diff" && command.args.includes("--numstat")) {
			return ok(output(`1\t0\t${fileIn(options.cwd)}.ts\n`));
		}
		if (first === "status" && second === "--porcelain") return ok(output(""));
		if (first === "ls-files") return ok(output(""));
		if (first === "rev-parse" && second === "HEAD") {
			return ok(output("", "fatal: no upstream", 128));
		}
		if (first === "rev-list" && second === "--count") return ok(output("0\n"));
		if (first === "log") return ok(output(""));
		return err(appError("git_failed", `unexpected command: ${command.args.join(" ")}`));
	});
	return { runner, branchReads: () => reads };
}

const workspaceId = "workspace-1" as WorkspaceId;

const context = (workspacePath = "/new"): WorkspaceGitContext => ({
	workspaceId,
	workspacePath,
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feat",
});

function makeService(
	runner: GitRunner,
	options: {
		contextOf?: (id: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
		now?: () => number;
	} = {},
): GitService {
	return new GitService({
		git: runner,
		cache: {} as never,
		contextOf: options.contextOf ?? (async () => ok(context())),
		agent: {} as never,
		renameWorkspaceBranch: async () => ok(undefined),
		now: options.now ?? (() => Date.now()),
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

const flush = async (): Promise<void> => {
	for (let index = 0; index < 500; index += 1) await Promise.resolve();
};

afterEach(() => {
	vi.useRealTimers();
});

describe("GIT-02 git service polling", () => {
	it("polls immediately and again after the interval until unsubscribed", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const { runner, branchReads } = pollRunner();
		const service = makeService(runner);
		const stop = service.watch(workspaceId, "full");
		await vi.advanceTimersByTimeAsync(0);
		await flush();
		expect(branchReads()).toBe(1);

		await vi.advanceTimersByTimeAsync(GIT_POLL_INTERVAL_MS);
		await flush();
		expect(branchReads()).toBe(2);

		stop();
		await vi.advanceTimersByTimeAsync(GIT_POLL_INTERVAL_MS * 4);
		await flush();
		expect(branchReads()).toBe(2);
	});

	it("shares one timer between two subscribers of the same workspace", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const { runner, branchReads } = pollRunner();
		const service = makeService(runner);
		const first = service.watch(workspaceId, "full");
		const second = service.watch(workspaceId, "full");
		await vi.advanceTimersByTimeAsync(0);
		await flush();
		expect(branchReads()).toBe(1);

		first();
		await vi.advanceTimersByTimeAsync(GIT_POLL_INTERVAL_MS);
		await flush();
		expect(branchReads()).toBe(2);

		second();
		await vi.advanceTimersByTimeAsync(GIT_POLL_INTERVAL_MS * 3);
		await flush();
		expect(branchReads()).toBe(2);
	});

	it("keeps the deepest depth when a second subscriber asks for less", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const { runner } = pollRunner();
		const service = makeService(runner);
		const full = service.watch(workspaceId, "full");
		const shallow = service.watch(workspaceId, "metadata");
		await vi.advanceTimersByTimeAsync(0);
		await flush();

		expect(service.store.getState().byWorkspace[workspaceId]?.snapshot?.files[0]?.path).toBe(
			"new.ts",
		);
		full();
		shallow();
	});

	it("reuses a result younger than 0.9 of the interval", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const { runner, branchReads } = pollRunner();
		const service = makeService(runner);
		await service.refresh(workspaceId, "full");
		expect(branchReads()).toBe(1);

		vi.setSystemTime(1_000_000 + 4_000);
		const stop = service.watch(workspaceId, "full");
		await vi.advanceTimersByTimeAsync(0);
		await flush();
		expect(branchReads()).toBe(1);

		await vi.advanceTimersByTimeAsync(GIT_POLL_INTERVAL_MS);
		await flush();
		expect(branchReads()).toBe(2);
		stop();
	});

	it("drops a slow answer when a newer refresh has already landed", async () => {
		let calls = 0;
		let releaseFirst: (() => void) | undefined;
		const firstContext = new Promise<Result<WorkspaceGitContext>>((resolve) => {
			releaseFirst = () => resolve(ok(context("/old")));
		});
		const { runner } = pollRunner();
		const service = makeService(runner, {
			contextOf: () => {
				calls += 1;
				return calls === 1 ? firstContext : Promise.resolve(ok(context("/new")));
			},
		});

		const slow = service.refresh(workspaceId, "full");
		const fast = service.refresh(workspaceId, "full");
		await fast;
		releaseFirst?.();
		await slow;

		const entry = service.store.getState().byWorkspace[workspaceId];
		expect(entry?.snapshot?.files[0]?.path).toBe("new.ts");
	});

	it("keeps the file list when a metadata poll only reads the branch", async () => {
		const { runner } = pollRunner();
		const service = makeService(runner);
		await service.refresh(workspaceId, "full");
		expect(service.store.getState().byWorkspace[workspaceId]?.snapshot?.files[0]?.path).toBe(
			"new.ts",
		);

		await service.refresh(workspaceId, "metadata");
		const snapshot = service.store.getState().byWorkspace[workspaceId]?.snapshot;
		expect(snapshot?.branch).toBe("feat");
		expect(snapshot?.files[0]?.path).toBe("new.ts");
	});

	it("drops an answer for a branch other than the one the request was made for", async () => {
		const { runner } = pollRunner("other");
		const service = makeService(runner);
		const result = await service.refresh(workspaceId, "full");
		expect(result.ok).toBe(true);
		expect(service.store.getState().byWorkspace[workspaceId]).toBeUndefined();
	});

	it("records a lookup failure in the workspace entry", async () => {
		const { runner } = pollRunner();
		const service = makeService(runner, {
			contextOf: async () => err(appError("workspace_unknown", "That workspace no longer exists.")),
		});
		const result = await service.refresh(workspaceId, "full");
		expect(result.ok).toBe(false);
		expect(service.store.getState().byWorkspace[workspaceId]?.error).toEqual({
			code: "workspace_unknown",
			message: "That workspace no longer exists.",
		});
	});
});

describe("GIT-02 refresh limiter", () => {
	it("runs at most four refreshes at once and lets the foreground request go first", async () => {
		const limiter = createRefreshLimiter();
		const started: string[] = [];
		const gates: (() => void)[] = [];
		const task = (name: string, foreground: boolean) =>
			limiter.run(name, foreground, () => {
				started.push(name);
				return new Promise<void>((resolve) => {
					gates.push(resolve);
				});
			});

		const background = ["b1", "b2", "b3", "b4", "b5"].map((name) => task(name, false));
		await flush();
		expect(started).toEqual(["b1", "b2", "b3", "b4"]);

		const foreground = task("foreground", true);
		await flush();
		expect(started).toEqual(["b1", "b2", "b3", "b4"]);

		gates[0]?.();
		await flush();
		expect(started).toEqual(["b1", "b2", "b3", "b4", "foreground"]);

		// Each freed slot starts the next queued task, so release gates as they appear.
		for (let index = 0; index < gates.length; index += 1) {
			gates[index]?.();
			await flush();
		}
		await Promise.all([...background, foreground]);
	});
});
