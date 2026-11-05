// @vitest-environment node
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appError, err, ok, type Result } from "@conducted/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type GitCommand,
	mergeBase,
	pushHeadSetUpstream,
	restoreStaged,
	revParse,
	showRefVerify,
	upstreamName,
} from "../core/git/commands.ts";
import { KeyedMutex } from "../core/git/locks.ts";
import { ShellGitRunner } from "../core/git/runner.ts";
import type { Shell, ShellCommand, ShellOutput } from "../platform/platform.ts";
import { FakeGitRunner, gitOutput, gitUnscripted } from "./fake-git-runner.ts";

let dir: string;
let origin: string;
let work: string;
let gitEnv: Record<string, string>;

/** A Shell over execFile with a fixed environment, so the user's git config never leaks in. */
const realShell: Shell = {
	run: (command: ShellCommand) =>
		new Promise((resolve) => {
			execFile(
				command.program,
				[...command.args],
				{ cwd: command.cwd, env: { ...gitEnv, ...command.env }, maxBuffer: 16 * 1024 * 1024 },
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
	loginEnv: async () => ({ shell: "/bin/sh", path: gitEnv.PATH ?? "" }),
};

const runnerOver = (shell: Shell): ShellGitRunner =>
	new ShellGitRunner({
		shell,
		locks: new KeyedMutex(),
		sleep: async () => undefined,
		log: () => undefined,
	});

/** A shell that gives one recorded answer to every command, so a command runs for real only once. */
const replayShell = (output: ShellOutput): Shell => ({
	run: async () => ok(output),
	start: () => {
		throw new Error("start is not used here");
	},
	loginEnv: async () => ({ shell: "/bin/sh", path: "" }),
});

/** Runs git for the setup and returns its trimmed stdout. */
const sh = (cwd: string, ...args: string[]): string =>
	execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: "pipe" }).trim();

let worktreeCounter = 0;
/** A new worktree on a new branch cut from main, so one probe never sees another's state. */
const worktree = (): { cwd: string; branch: string } => {
	const branch = `probe-${++worktreeCounter}`;
	const cwd = join(dir, branch);
	sh(work, "worktree", "add", "-q", "-b", branch, cwd, "main");
	return { cwd, branch };
};

const commitFile = (cwd: string, name: string): void => {
	writeFileSync(join(cwd, name), `${name}\n`);
	sh(cwd, "add", name);
	sh(cwd, "commit", "-q", "-m", `add ${name}`);
};

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "conducted-fake-git-"));
	origin = join(dir, "origin.git");
	work = join(dir, "work");
	gitEnv = {
		PATH: process.env.PATH ?? "",
		HOME: dir,
		LC_ALL: "C",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.com",
	};
	sh(dir, "init", "-q", "--bare", "-b", "main", origin);
	sh(dir, "init", "-q", "-b", "main", work);
	sh(work, "remote", "add", "origin", origin);
	commitFile(work, "base.txt");
	sh(work, "push", "-q", "-u", "origin", "main");
	// A branch with no common history with main: an empty tree under a parentless commit.
	const emptyTree = sh(work, "hash-object", "-t", "tree", "/dev/null");
	sh(work, "branch", "unrelated", sh(work, "commit-tree", emptyTree, "-m", "unrelated"));
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

interface Probe {
	name: string;
	/** Puts the repository in the state the command needs and says where to run it. */
	prepare: () => { command: GitCommand; cwd: string };
	exitCode: number;
	/** What git prints on stdout, with 40-digit hashes written as <sha>. */
	stdout: string;
	/** What the fake prints on stderr. Git's own text must match `stderrPattern`. */
	fakeStderr: string;
	/** Null when git prints nothing on stderr. */
	stderrPattern: RegExp | null;
}

const PROBES: readonly Probe[] = [
	{
		name: "merge-base of two related branches",
		prepare: () => {
			const { cwd } = worktree();
			commitFile(cwd, "ahead.txt");
			return { command: mergeBase("main", "HEAD"), cwd };
		},
		exitCode: 0,
		stdout: "<sha>\n",
		fakeStderr: "",
		stderrPattern: null,
	},
	{
		name: "merge-base of branches with no common history",
		prepare: () => ({ command: mergeBase("main", "unrelated"), cwd: work }),
		exitCode: 1,
		stdout: "",
		fakeStderr: "",
		stderrPattern: null,
	},
	{
		name: "merge-base with a ref that does not exist",
		prepare: () => ({ command: mergeBase("main", "no-such-ref"), cwd: work }),
		exitCode: 128,
		stdout: "",
		fakeStderr: "fatal: Not a valid object name no-such-ref\n",
		stderrPattern: /^fatal: Not a valid object name no-such-ref\n$/,
	},
	{
		name: "show-ref of a branch that exists",
		prepare: () => ({ command: showRefVerify("refs/heads/main"), cwd: work }),
		exitCode: 0,
		stdout: "",
		fakeStderr: "",
		stderrPattern: null,
	},
	{
		name: "show-ref of a branch that is missing",
		prepare: () => ({ command: showRefVerify("refs/heads/no-such-branch"), cwd: work }),
		exitCode: 1,
		stdout: "",
		fakeStderr: "",
		stderrPattern: null,
	},
	{
		name: "rev-parse @{u} on a branch with an upstream",
		prepare: () => ({ command: revParse("@{u}"), cwd: work }),
		exitCode: 0,
		stdout: "<sha>\n",
		fakeStderr: "",
		stderrPattern: null,
	},
	{
		name: "rev-parse @{u} on a branch with no upstream",
		prepare: () => {
			const { cwd } = worktree();
			return { command: revParse("@{u}"), cwd };
		},
		exitCode: 128,
		stdout: "",
		fakeStderr: "fatal: no upstream configured for branch 'probe-N'\n",
		stderrPattern: /^fatal: no upstream configured for branch 'probe-N'\n$/,
	},
	{
		name: "the upstream name on a branch with an upstream",
		prepare: () => ({ command: upstreamName(), cwd: work }),
		exitCode: 0,
		stdout: "origin/main\n",
		fakeStderr: "",
		stderrPattern: null,
	},
	{
		name: "push -u of a new branch",
		prepare: () => {
			const { cwd, branch } = worktree();
			commitFile(cwd, "pushed.txt");
			return { command: pushHeadSetUpstream("origin", branch), cwd };
		},
		exitCode: 0,
		// git prints the tracking line on stdout and the transfer summary on stderr.
		stdout: "branch 'probe-N' set up to track 'origin/probe-N'.\n",
		fakeStderr: "To <dir>/origin.git\n * [new branch]      HEAD -> probe-N\n",
		stderrPattern: /^To <dir>\/origin\.git\n \* \[new branch\] +HEAD -> probe-N\n$/,
	},
	{
		name: "push -u to a remote that does not exist",
		prepare: () => ({ command: pushHeadSetUpstream("nowhere", "x"), cwd: work }),
		exitCode: 128,
		stdout: "",
		fakeStderr:
			"fatal: 'nowhere' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n",
		stderrPattern: /^fatal: 'nowhere' does not appear to be a git repository\n/,
	},
	{
		name: "restore --staged of a staged new file",
		prepare: () => {
			const { cwd } = worktree();
			writeFileSync(join(cwd, "staged.txt"), "s\n");
			sh(cwd, "add", "staged.txt");
			return { command: restoreStaged("staged.txt"), cwd };
		},
		exitCode: 0,
		stdout: "",
		fakeStderr: "",
		stderrPattern: null,
	},
	{
		name: "restore --staged of an untracked file",
		prepare: () => {
			const { cwd } = worktree();
			writeFileSync(join(cwd, "untracked.txt"), "u\n");
			return { command: restoreStaged("untracked.txt"), cwd };
		},
		exitCode: 1,
		stdout: "",
		fakeStderr: "error: pathspec 'untracked.txt' did not match any file(s) known to git\n",
		stderrPattern: /^error: pathspec 'untracked.txt' did not match any file\(s\) known to git\n$/,
	},
];

/** Hashes, the run's folder and the probe's branch number become placeholders. */
const normalise = (text: string): string =>
	text
		.replaceAll(dir, "<dir>")
		.replace(/\b[0-9a-f]{40}\b/g, "<sha>")
		.replace(/probe-\d+/g, "probe-N");

/** What a caller sees from each of the three ways to run a command, reduced to comparable data. */
async function seen(runner: ShellGitRunner | FakeGitRunner, command: GitCommand, cwd: string) {
	const brief = (result: Result<unknown>) =>
		result.ok ? "ok" : `${result.error.code}: ${normalise(result.error.message)}`;
	const run = await runner.run(command, { cwd });
	const checked = await runner.runChecked(command, { cwd });
	const stdout = await runner.stdout(command, { cwd });
	return {
		run: run.ok
			? { exitCode: run.value.exitCode, stdout: normalise(run.value.stdout) }
			: brief(run),
		checked: brief(checked),
		stdout: stdout.ok ? normalise(stdout.value) : brief(stdout),
	};
}

describe("fake git runner against real git", () => {
	it.each(PROBES)("$name", async (probe) => {
		const { command, cwd } = probe.prepare();

		const real = await runnerOver(realShell).run(command, { cwd });
		if (!real.ok) throw new Error(`git did not run: ${real.error.message}`);
		expect(real.value.exitCode).toBe(probe.exitCode);
		expect(normalise(real.value.stdout)).toBe(probe.stdout);
		if (probe.stderrPattern === null) expect(real.value.stderr).toBe("");
		else expect(normalise(real.value.stderr)).toMatch(probe.stderrPattern);

		// The fake is given the same answer as text, so it must hold up under the same patterns.
		if (probe.stderrPattern !== null) expect(probe.fakeStderr).toMatch(probe.stderrPattern);
		const fake = new FakeGitRunner((asked) =>
			asked.args.join("\0") === command.args.join("\0")
				? gitOutput(probe.stdout, probe.fakeStderr, probe.exitCode)
				: gitUnscripted(asked),
		);
		const fromFake = await fake.run(command, { cwd });
		expect(fromFake).toEqual(
			ok<ShellOutput>({
				exitCode: probe.exitCode,
				stdout: probe.stdout,
				stderr: probe.fakeStderr,
			}),
		);

		// run, runChecked and stdout agree on what a caller sees: success, or which error. The real
		// runner meets git's recorded answer, because running a git command twice can change its answer.
		const realSeen = await seen(runnerOver(replayShell(real.value)), command, cwd);
		const fakeSeen = await seen(fake, command, cwd);
		expect(fakeSeen).toEqual(realSeen);
	});

	it("covers the exit codes 0, 1 and 128 of merge-base, and a probe that the command accepts as success", () => {
		const codes = (needle: string) =>
			PROBES.filter((probe) => probe.name.startsWith(needle)).map((probe) => probe.exitCode);
		expect(codes("merge-base").sort()).toEqual([0, 1, 128]);
		expect(codes("show-ref").sort()).toEqual([0, 1]);
		expect(codes("restore --staged").sort()).toEqual([0, 1]);
	});
});

describe("fake git runner behaviour", () => {
	const command: GitCommand = { program: "git", args: ["status"] };

	it("answers a command nobody scripted with an Err, never an Ok", async () => {
		const fake = new FakeGitRunner((asked) => gitUnscripted(asked));
		const result = await fake.run(command, { cwd: "/w" });
		expect(result).toMatchObject({
			ok: false,
			error: { code: "git_unscripted", message: expect.stringContaining("git status") },
		});
	});

	it("records every call in order with its options", async () => {
		const fake = new FakeGitRunner(() => gitOutput());
		await fake.run(command, { cwd: "/a" });
		await fake.runChecked({ program: "git", args: ["log"] }, { cwd: "/b", env: { K: "v" } });
		expect(fake.calls).toEqual([
			{ command, options: { cwd: "/a" } },
			{ command: { program: "git", args: ["log"] }, options: { cwd: "/b", env: { K: "v" } } },
		]);
		expect(fake.commands.map((recorded) => recorded.args[0])).toEqual(["status", "log"]);
	});

	it("holds the lock for the whole of one call, so the next call on that key waits", async () => {
		const fake = new FakeGitRunner(() => gitOutput());
		const order: string[] = [];
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let firstIsInside: () => void = () => {};
		const inside = new Promise<void>((resolve) => {
			firstIsInside = resolve;
		});
		const first = fake.withWorktreeLock("/w", async () => {
			order.push("first-start");
			firstIsInside();
			await gate;
			order.push("first-end");
		});
		await inside;
		const second = fake.withWorktreeLock("/w", async () => {
			order.push("second");
		});
		const other = fake.withWorktreeLock("/other", async () => {
			order.push("other");
		});
		await other;
		expect(order).toEqual(["first-start", "other"]);
		release();
		await Promise.all([first, second]);
		expect(order).toEqual(["first-start", "other", "first-end", "second"]);
	});

	it("takes the repo lock inside the worktree lock", async () => {
		const fake = new FakeGitRunner(() => gitOutput());
		const held: boolean[] = [];
		await fake.withWorktreeAndRepoLocks("/w", "/repo", async () => {
			held.push(fake.locks.isHeld("worktree:/w"), fake.locks.isHeld("repo:/repo"));
		});
		expect(held).toEqual([true, true]);
		expect(fake.locks.size).toBe(0);
	});

	it("refuses start unless the test scripted it", async () => {
		const fake = new FakeGitRunner(() => gitOutput());
		await expect(fake.start(command, { cwd: "/w" })).rejects.toThrow("start was not scripted");
	});
});
