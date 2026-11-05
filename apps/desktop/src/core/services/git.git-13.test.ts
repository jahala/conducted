import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import {
	decideFetch,
	FETCH_MIN_GAP_MS,
	type FetchStaleness,
	GitService,
	type WorkspaceGitContext,
} from "./git.ts";

const workspaceId = "ws-git-13" as WorkspaceId;
const otherWorkspaceId = "ws-git-13-other" as WorkspaceId;
const start = 1_000_000;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

const staleness = (overrides: Partial<FetchStaleness> = {}): FetchStaleness => ({
	remote: "origin",
	targetBranch: "main",
	branch: "feat",
	prBaseOid: "base",
	prHeadOid: "head",
	localBaseOid: "base",
	upstreamOid: "head",
	baseIsLocalStackParent: false,
	...overrides,
});

const baseRefspec = "+refs/heads/main:refs/remotes/origin/main";
const headRefspec = "+refs/heads/feat:refs/remotes/origin/feat";

describe("GIT-13 decideFetch", () => {
	it("fetches nothing when the PR base and head match the local refs", () => {
		expect(decideFetch(staleness(), null, start)).toEqual({ fetch: false, reason: "in_sync" });
	});

	it("fetches the base branch when the PR base differs", () => {
		expect(decideFetch(staleness({ prBaseOid: "new-base" }), null, start)).toEqual({
			fetch: true,
			refspecs: [baseRefspec],
		});
	});

	it("fetches the head branch when the PR head differs", () => {
		expect(decideFetch(staleness({ prHeadOid: "new-head" }), null, start)).toEqual({
			fetch: true,
			refspecs: [headRefspec],
		});
	});

	it("fetches both branches once when both differ", () => {
		expect(
			decideFetch(staleness({ prBaseOid: "new-base", prHeadOid: "new-head" }), null, start),
		).toEqual({ fetch: true, refspecs: [baseRefspec, headRefspec] });
	});

	it("treats a missing local base or upstream as a difference", () => {
		expect(decideFetch(staleness({ localBaseOid: null }), null, start)).toEqual({
			fetch: true,
			refspecs: [baseRefspec],
		});
		expect(decideFetch(staleness({ upstreamOid: null }), null, start)).toEqual({
			fetch: true,
			refspecs: [headRefspec],
		});
	});

	it("skips the base of a local stack parent but still fetches a stale head", () => {
		expect(
			decideFetch(staleness({ baseIsLocalStackParent: true, prHeadOid: "new-head" }), null, start),
		).toEqual({ fetch: true, refspecs: [headRefspec] });
	});

	it("reports a stack parent instead of fetching when only its base differs", () => {
		expect(
			decideFetch(staleness({ baseIsLocalStackParent: true, prBaseOid: "new-base" }), null, start),
		).toEqual({ fetch: false, reason: "stack_parent" });
	});

	it("waits the minimum gap and fetches again at the boundary", () => {
		expect(decideFetch(staleness({ prHeadOid: "new-head" }), start, start + 59_999)).toEqual({
			fetch: false,
			reason: "too_soon",
		});
		expect(decideFetch(staleness({ prHeadOid: "new-head" }), start, start + 60_000)).toEqual({
			fetch: true,
			refspecs: [headRefspec],
		});
	});

	it("reports in_sync before too_soon", () => {
		expect(decideFetch(staleness(), start, start + 1)).toEqual({
			fetch: false,
			reason: "in_sync",
		});
	});
});

interface FetchRecorder {
	fetches: GitCommand[];
}

function fetchRunner(): { runner: GitRunner; recorder: FetchRecorder } {
	const recorder: FetchRecorder = { fetches: [] };
	const refs = new Map<string, string>([
		["refs/remotes/origin/main", "base"],
		["refs/remotes/origin/feat", "head"],
	]);

	const reply = (command: GitCommand): Result<ShellOutput> => {
		const args = command.args;
		if (command.program === "stat") return ok(output("", "", 1));
		if (args[0] === "fetch") {
			recorder.fetches.push(command);
			return ok(output(""));
		}
		if (args[0] === "rev-parse" && args[1] === "--verify") {
			const ref = args.at(-1) ?? "";
			const oid = refs.get(ref);
			return oid === undefined ? ok(output("", "", 1)) : ok(output(`${oid}\n`));
		}
		if (args[0] === "rev-parse" && args.includes("@{u}")) {
			return ok(output("", "fatal: no upstream", 128));
		}
		if (args[0] === "rev-parse" && args[1] === "--git-path") {
			return ok(output(`/git/${args.at(-1)}\n`));
		}
		if (args[0] === "branch" && args[1] === "--show-current") return ok(output("feat\n"));
		if (args[0] === "merge-base") return ok(output("mb\n"));
		if (args[0] === "diff") return ok(output(""));
		if (args[0] === "status") return ok(output(""));
		if (args[0] === "ls-files") return ok(output(""));
		if (args[0] === "rev-list") return ok(output("0\n"));
		if (args[0] === "log") return ok(output(""));
		return ok(output(""));
	};

	return { recorder, runner: new FakeGitRunner(reply) };
}

const context = (overrides: Partial<WorkspaceGitContext> = {}): WorkspaceGitContext => ({
	workspaceId,
	workspacePath: "/repo/worktree",
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
		now?: () => number;
	} = {},
): GitService {
	return new GitService({
		git: runner,
		cache: {} as never,
		contextOf: options.contextOf ?? (async () => ok(context())),
		agent: {} as never,
		renameWorkspaceBranch: async () => ok(undefined),
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
		now: options.now ?? (() => start),
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

describe("GIT-13 fetchIfStale", () => {
	it("fetches a stale base ref and then refreshes the workspace", async () => {
		const { runner, recorder } = fetchRunner();
		const service = makeService(runner);

		const result = await service.fetchIfStale(workspaceId, {
			prBaseOid: "new-base",
			prHeadOid: "head",
		});

		expect(result).toEqual(ok({ fetched: true }));
		expect(recorder.fetches).toHaveLength(1);
		expect(recorder.fetches[0]?.args).toEqual([
			"fetch",
			"--no-write-fetch-head",
			"--prune",
			"--",
			"origin",
			baseRefspec,
		]);
		expect(service.store.getState().byWorkspace[workspaceId]?.snapshot?.branch).toBe("feat");
	});

	it("does not fetch when the PR refs already match, and does not refresh", async () => {
		const { runner, recorder } = fetchRunner();
		const service = makeService(runner);

		const result = await service.fetchIfStale(workspaceId, {
			prBaseOid: "base",
			prHeadOid: "head",
		});

		expect(result).toEqual(ok({ fetched: false }));
		expect(recorder.fetches).toHaveLength(0);
		expect(service.store.getState().byWorkspace[workspaceId]).toBeUndefined();
	});

	it("fetches a target stored as a full remote ref under its plain branch name", async () => {
		const { runner, recorder } = fetchRunner();
		const service = makeService(runner, {
			contextOf: async () => ok(context({ targetBranch: "refs/remotes/origin/main" })),
		});

		const result = await service.fetchIfStale(workspaceId, {
			prBaseOid: "new-base",
			prHeadOid: "head",
		});

		expect(result).toEqual(ok({ fetched: true }));
		expect(recorder.fetches[0]?.args).toEqual([
			"fetch",
			"--no-write-fetch-head",
			"--prune",
			"--",
			"origin",
			baseRefspec,
		]);
	});

	it("fetches at most once a minute for one repository and branch", async () => {
		let now = start;
		const { runner, recorder } = fetchRunner();
		const service = makeService(runner, { now: () => now });
		const oids = { prBaseOid: "new-base", prHeadOid: "head" };

		expect(await service.fetchIfStale(workspaceId, oids)).toEqual(ok({ fetched: true }));
		now = start + FETCH_MIN_GAP_MS - 1;
		expect(await service.fetchIfStale(workspaceId, oids)).toEqual(ok({ fetched: false }));
		now = start + FETCH_MIN_GAP_MS;
		expect(await service.fetchIfStale(workspaceId, oids)).toEqual(ok({ fetched: true }));

		expect(recorder.fetches).toHaveLength(2);
	});

	it("fetches once when two calls overlap", async () => {
		const { runner, recorder } = fetchRunner();
		const service = makeService(runner);
		const oids = { prBaseOid: "new-base", prHeadOid: "head" };

		const [first, second] = await Promise.all([
			service.fetchIfStale(workspaceId, oids),
			service.fetchIfStale(workspaceId, oids),
		]);

		expect(recorder.fetches).toHaveLength(1);
		expect([first, second].filter((result) => result.ok && result.value.fetched)).toHaveLength(1);
	});

	it("uses one key for two workspaces in the same repository and branch", async () => {
		const { runner, recorder } = fetchRunner();
		const service = makeService(runner);
		const oids = { prBaseOid: "new-base", prHeadOid: "head" };

		expect(await service.fetchIfStale(workspaceId, oids)).toEqual(ok({ fetched: true }));
		expect(await service.fetchIfStale(otherWorkspaceId, oids)).toEqual(ok({ fetched: false }));

		expect(recorder.fetches).toHaveLength(1);
	});

	it("returns a context failure without fetching", async () => {
		const { runner, recorder } = fetchRunner();
		const service = makeService(runner, {
			contextOf: async () => err(appError("workspace_unknown", "That workspace is gone.")),
		});

		const result = await service.fetchIfStale(workspaceId, {
			prBaseOid: "new-base",
			prHeadOid: "head",
		});

		expect(result).toEqual(err(appError("workspace_unknown", "That workspace is gone.")));
		expect(recorder.fetches).toHaveLength(0);
	});

	it("returns a failed fetch and still waits a minute before trying again", async () => {
		let now = start;
		let attempts = 0;
		const { runner } = fetchRunner();
		// FakeGitRunner is a class, so a spread would drop its methods: each one is passed on.
		const failing: GitRunner = {
			run: (command, options) => runner.run(command, options),
			stdout: (command, options) => runner.stdout(command, options),
			start: (command, options) => runner.start(command, options),
			withWorktreeLock: (worktreePath, work) => runner.withWorktreeLock(worktreePath, work),
			withWorktreeAndRepoLocks: (worktreePath, repoPath, work) =>
				runner.withWorktreeAndRepoLocks(worktreePath, repoPath, work),
			runChecked: async (command, options) => {
				const result = await runner.runChecked(command, options as GitRunOptions);
				if (command.args[0] !== "fetch") return result;
				attempts += 1;
				return err(appError("process_spawn", "git could not start."));
			},
		};
		const service = makeService(failing, { now: () => now });
		const oids = { prBaseOid: "new-base", prHeadOid: "head" };

		expect(await service.fetchIfStale(workspaceId, oids)).toEqual(
			err(appError("process_spawn", "git could not start.")),
		);
		now = start + 1_000;
		expect(await service.fetchIfStale(workspaceId, oids)).toEqual(ok({ fetched: false }));
		expect(attempts).toBe(1);
	});
});
