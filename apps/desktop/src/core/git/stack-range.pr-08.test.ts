/**
 * @feature PR-08 PR and stack range diffs
 * Owns: the tests that a stack's pull requests become ranges (open ones only, each based on the one
 * below), that both commit ids are checked in a real repository, missing ones are fetched by branch
 * name, the merge base is found and each pull request comes back resolved or unresolved, and that a
 * selection of pull requests becomes one run or the reason it cannot.
 * Behaviour: services-map.md 3.4.5 (`Ctt`), 3.4.1 (view mode `range`).
 * Test first: a stack whose head commits are only on the remote resolves after one fetch of their
 * branches, each from the merge base of its base and head.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appError, err, ok } from "@conducted/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Shell, ShellCommand } from "../../platform/platform.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import { fetch } from "./commands.ts";
import { KeyedMutex } from "./locks.ts";
import { ShellGitRunner } from "./runner.ts";
import {
	type PullRequestRange,
	type RangePullRequest,
	resolvePullRequestRanges,
	type StackRangeMember,
	selectStackRun,
	stackRangePullRequests,
} from "./stack-range.ts";

// A Shell over node's execFile, so the resolver meets the real git binary.
const realShell: Shell = {
	run: (command: ShellCommand) =>
		new Promise((resolve) => {
			execFile(
				command.program,
				[...command.args],
				{ cwd: command.cwd, env: { ...process.env, ...command.env }, maxBuffer: 16 * 1024 * 1024 },
				(error, stdout, stderr) => {
					if (error !== null && typeof error.code !== "number") {
						resolve(err(appError("process_spawn", error.message)));
						return;
					}
					resolve(ok({ exitCode: error === null ? 0 : (error.code as number), stdout, stderr }));
				},
			);
		}),
	start: () => {
		throw new Error("start is not used here");
	},
	loginEnv: async () => ({ shell: "/bin/zsh", path: process.env.PATH ?? "", zdotdir: null }),
};

const runner = new ShellGitRunner({
	shell: realShell,
	locks: new KeyedMutex(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	log: () => undefined,
	programsBin: "",
	programPath: async () => err(appError("program_not_installed", "The app's gh is not installed.")),
});

let root: string;
let origin: string;
let workspace: string;
const oids: Record<string, string> = {};

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

function commit(cwd: string, file: string, text: string, name: string): void {
	writeFileSync(join(cwd, file), text);
	git(cwd, "add", file);
	git(cwd, "commit", "-q", "-m", name);
	oids[name] = git(cwd, "rev-parse", "HEAD");
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "conducted-stack-range-"));
	origin = join(root, "origin");
	workspace = join(root, "workspace");
	execFileSync("git", ["init", "-q", "-b", "main", origin], { stdio: "pipe" });
	commit(origin, "base.txt", "base\n", "m0");
	git(origin, "checkout", "-q", "-b", "feat-a");
	commit(origin, "a.txt", "a\n", "a1");
	git(origin, "checkout", "-q", "-b", "feat-b");
	commit(origin, "b.txt", "b\n", "b1");
	execFileSync("git", ["clone", "-q", origin, workspace], { stdio: "pipe" });
	git(workspace, "checkout", "-q", "feat-b");
	// After the clone, feat-a moves on and feat-c is pushed: the workspace has neither commit.
	git(origin, "checkout", "-q", "feat-a");
	commit(origin, "a.txt", "a\na2\n", "a2");
	git(origin, "checkout", "-q", "feat-b");
	git(origin, "checkout", "-q", "-b", "feat-c");
	commit(origin, "c.txt", "c\n", "c1");
	git(origin, "checkout", "-q", "main");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const fetchInWorkspace = (calls: string[][]) => async (branches: readonly string[]) => {
	calls.push([...branches]);
	const fetched = await runner.runChecked(fetch("origin", branches), { cwd: workspace });
	return fetched.ok ? ok(undefined) : fetched;
};

const pr = (
	prNumber: number,
	headBranch: string,
	headOid: string,
	baseBranch: string,
	baseOid: string,
): RangePullRequest => ({ prNumber, headBranch, headOid, baseBranch, baseOid });

describe("PR-08 stack range resolution in a real repository", () => {
	it("fetches missing commits by branch once, then resolves each pull request from its merge base", async () => {
		const pullRequests = stackRangePullRequests([
			{
				number: 10,
				branch: "feat-a",
				state: "open",
				headSha: oids.a2 as string,
				baseSha: oids.m0 as string,
				baseBranch: "main",
			},
			{
				number: 11,
				branch: "feat-b",
				state: "open",
				headSha: oids.b1 as string,
				baseSha: oids.a1 as string,
				baseBranch: "feat-a",
			},
			{
				number: 12,
				branch: "feat-c",
				state: "draft",
				headSha: oids.c1 as string,
				baseSha: oids.b1 as string,
				baseBranch: "feat-b",
			},
		]);
		const calls: string[][] = [];

		const resolved = await resolvePullRequestRanges(runner, {
			cwd: workspace,
			pullRequests,
			liveBranch: "feat-b",
			fetchBranches: fetchInWorkspace(calls),
		});

		expect(calls).toEqual([["feat-a", "feat-c"]]);
		expect(resolved).toEqual(
			ok({
				fetchError: null,
				pullRequests: [
					{
						...pr(10, "feat-a", oids.a2 as string, "main", oids.m0 as string),
						isLive: false,
						status: "resolved",
						fromOid: oids.m0,
					},
					{
						// Based on the pull request below it: feat-a at a2, so the range starts at a1.
						...pr(11, "feat-b", oids.b1 as string, "feat-a", oids.a2 as string),
						isLive: true,
						status: "resolved",
						fromOid: oids.a1,
					},
					{
						...pr(12, "feat-c", oids.c1 as string, "feat-b", oids.b1 as string),
						isLive: false,
						status: "resolved",
						fromOid: oids.b1,
					},
				],
			}),
		);
	});

	it("returns unresolved with missing-head or missing-base when a fetch cannot bring the commits", async () => {
		const ghostHead = "f".repeat(40);
		const ghostBase = "e".repeat(40);
		const calls: string[][] = [];

		const resolved = await resolvePullRequestRanges(runner, {
			cwd: workspace,
			pullRequests: [
				pr(13, "gone-head", ghostHead, "main", oids.m0 as string),
				pr(14, "feat-b", oids.b1 as string, "gone-base", ghostBase),
			],
			liveBranch: "feat-b",
			fetchBranches: fetchInWorkspace(calls),
		});

		expect(calls).toEqual([["gone-head", "gone-base"]]);
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.value.pullRequests).toEqual([
			{
				...pr(13, "gone-head", ghostHead, "main", oids.m0 as string),
				isLive: false,
				status: "unresolved",
				reason: "missing-head",
			},
			{
				...pr(14, "feat-b", oids.b1 as string, "gone-base", ghostBase),
				isLive: true,
				status: "unresolved",
				reason: "missing-base",
			},
		]);
		// The failed fetch is handed back, not dropped.
		expect(resolved.value.fetchError?.code).toBe("git_failed");
	});

	it("fetches nothing when every commit is already in the workspace", async () => {
		const calls: string[][] = [];
		const resolved = await resolvePullRequestRanges(runner, {
			cwd: workspace,
			pullRequests: [pr(11, "feat-b", oids.b1 as string, "feat-a", oids.a1 as string)],
			liveBranch: "feat-b",
			fetchBranches: fetchInWorkspace(calls),
		});
		expect(calls).toEqual([]);
		expect(resolved.ok && resolved.value.pullRequests[0]).toMatchObject({
			status: "resolved",
			fromOid: oids.a1,
		});
	});
});

describe("PR-08 stack range checks", () => {
	it("treats a rev-parse exit code other than 0 or 1 as an error, not a missing commit", async () => {
		const fake = new FakeGitRunner((command) =>
			command.args[0] === "rev-parse"
				? gitOutput("", "fatal: not a git repository", 128)
				: gitOutput(""),
		);
		const resolved = await resolvePullRequestRanges(fake, {
			cwd: "/nowhere",
			pullRequests: [pr(1, "a", "a".repeat(40), "main", "b".repeat(40))],
			liveBranch: "a",
			fetchBranches: async () => ok(undefined),
		});
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.error.message).toContain("not a git repository");
	});

	it("refuses a commit id that git could read as an option", async () => {
		const fake = new FakeGitRunner(() => gitOutput(""));
		const resolved = await resolvePullRequestRanges(fake, {
			cwd: "/nowhere",
			pullRequests: [pr(1, "a", "--output=x", "main", "b".repeat(40))],
			liveBranch: "a",
			fetchBranches: async () => ok(undefined),
		});
		expect(resolved.ok).toBe(false);
		expect(fake.commands).toEqual([]);
	});
});

const member = (over: Partial<StackRangeMember> & { number: number }): StackRangeMember => ({
	branch: `b${over.number}`,
	state: "open",
	headSha: `h${over.number}`,
	baseSha: `base${over.number}`,
	baseBranch: `base-branch${over.number}`,
	...over,
});

describe("PR-08 stack pull requests as ranges", () => {
	it("keeps open pull requests and bases each on the open one below it", () => {
		expect(
			stackRangePullRequests([
				member({ number: 1, state: "merged" }),
				member({ number: 2 }),
				member({ number: 3, state: "closed" }),
				member({ number: 4, state: "draft" }),
			]),
		).toEqual([
			{
				prNumber: 2,
				headBranch: "b2",
				headOid: "h2",
				baseBranch: "base-branch2",
				baseOid: "base2",
			},
			{ prNumber: 4, headBranch: "b4", headOid: "h4", baseBranch: "b2", baseOid: "h2" },
		]);
	});
});

const rung = (prNumber: number, over: Partial<PullRequestRange> = {}): PullRequestRange =>
	({
		prNumber,
		headBranch: `b${prNumber}`,
		headOid: `h${prNumber}`,
		baseBranch: `b${prNumber - 1}`,
		baseOid: `h${prNumber - 1}`,
		isLive: false,
		status: "resolved",
		fromOid: `from${prNumber}`,
		...over,
	}) as PullRequestRange;

describe("PR-08 choosing a run of stack pull requests", () => {
	const rungs = [rung(1), rung(2), rung(3, { isLive: true }), rung(4)];

	it("runs from the bottom pull request's start to the top pull request's head", () => {
		const selection = selectStackRun(rungs, [2, 1]);
		expect(selection).toMatchObject({
			kind: "run",
			bottom: { prNumber: 1 },
			top: { prNumber: 2 },
		});
	});

	it("is the checked-out branch when only the live pull request or nothing in the stack is chosen", () => {
		expect(selectStackRun(rungs, [3])).toEqual({ kind: "checkedOut" });
		expect(selectStackRun(rungs, [99])).toEqual({ kind: "checkedOut" });
	});

	it("refuses pull requests that are not next to each other", () => {
		expect(selectStackRun(rungs, [1, 3])).toEqual({ kind: "nonAdjacent" });
	});

	it("names the pull request whose commits are missing", () => {
		const missing = [
			rung(1, { status: "unresolved", reason: "missing-base" } as Partial<PullRequestRange>),
			rung(2, { status: "unresolved", reason: "missing-head" } as Partial<PullRequestRange>),
			rung(3, {
				isLive: true,
				status: "unresolved",
				reason: "missing-head",
			} as Partial<PullRequestRange>),
		];
		expect(selectStackRun(missing, [1, 2])).toEqual({ kind: "unavailable", prNumber: 1 });
		expect(selectStackRun([rung(1), missing[1] as PullRequestRange], [1, 2])).toEqual({
			kind: "unavailable",
			prNumber: 2,
		});
		// The live top is read from the working tree, so its missing head does not matter.
		expect(selectStackRun([rung(2), missing[2] as PullRequestRange], [2, 3])).toMatchObject({
			kind: "run",
		});
	});
});
