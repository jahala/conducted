/**
 * @feature GIT-11 Git busy check
 * Owns: bin/git-busy-check.sh, driven here against real temporary repositories.
 * Behaviour: research/conductor/native-and-sidecar-map.md C2. Conductor's own script exits 0 for
 * every state it prints, including busy states; exit 2 means a bad path or a non-repository.
 * Test first: a conflicting `git merge` prints busy:merge, and after `git merge --abort` it prints
 * clean.
 *
 * The script lives in bin/, which `pnpm test` does not scan. This test sits with the checkpoint
 * code that calls the script, so CI runs it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../../bin/git-busy-check.sh");

const ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.invalid",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.invalid",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
};

interface Run {
	code: number | null;
	out: string;
	err: string;
}

let base = "";
let repo = "";

function run(command: string[], cwd: string): Run {
	const result = Bun.spawnSync(command, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
	return {
		code: result.exitCode,
		out: result.stdout.toString().trim(),
		err: result.stderr.toString().trim(),
	};
}

function git(cwd: string, ...args: string[]): Run {
	return run(["git", ...args], cwd);
}

function gitOk(cwd: string, ...args: string[]): string {
	const result = git(cwd, ...args);
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.err}`);
	return result.out;
}

function check(path: string, cwd = repo): Run {
	return run(["bash", SCRIPT, path], cwd);
}

function write(file: string, text: string): void {
	writeFileSync(join(repo, file), text);
}

function commit(file: string, text: string, message: string): void {
	write(file, text);
	gitOk(repo, "add", file);
	gitOk(repo, "commit", "-q", "-m", message);
}

/** Put main and a branch named "other" on conflicting edits of shared.txt. */
function diverge(): void {
	gitOk(repo, "checkout", "-q", "-b", "other");
	commit("shared.txt", "other\n", "other change");
	gitOk(repo, "checkout", "-q", "main");
	commit("shared.txt", "main\n", "main change");
}

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "git-busy-"));
	repo = join(base, "repo with spaces");
	mkdirSync(repo);
	gitOk(repo, "init", "-q", "-b", "main");
	commit("shared.txt", "base\n", "base");
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("GIT-11 git-busy-check.sh", () => {
	test("prints clean and exits 0 when git is idle", () => {
		expect(check(repo)).toEqual({ code: 0, out: "clean", err: "" });
	});

	test("prints busy:merge during a conflicting merge, then clean after abort", () => {
		diverge();
		expect(git(repo, "merge", "other").code).not.toBe(0);

		expect(check(repo)).toEqual({ code: 0, out: "busy:merge", err: "" });

		gitOk(repo, "merge", "--abort");
		expect(check(repo)).toEqual({ code: 0, out: "clean", err: "" });
	});

	test("prints busy:rebase during a conflicting rebase", () => {
		diverge();
		expect(git(repo, "rebase", "other").code).not.toBe(0);

		expect(check(repo)).toEqual({ code: 0, out: "busy:rebase", err: "" });
	});

	test("prints busy:squash-merge only when a squash left conflicts", () => {
		diverge();
		expect(git(repo, "merge", "--squash", "other").code).not.toBe(0);
		expect(check(repo).out).toBe("busy:squash-merge");

		gitOk(repo, "reset", "-q", "--hard", "HEAD");
		gitOk(repo, "checkout", "-q", "-b", "quiet");
		commit("quiet.txt", "quiet\n", "quiet change");
		gitOk(repo, "checkout", "-q", "main");
		expect(git(repo, "merge", "--squash", "quiet").code).toBe(0);
		expect(check(repo).out).toBe("clean");
	});

	test("prints busy:cherry-pick during a conflicting cherry-pick", () => {
		diverge();
		expect(git(repo, "cherry-pick", "other").code).not.toBe(0);

		expect(check(repo)).toEqual({ code: 0, out: "busy:cherry-pick", err: "" });
	});

	test("prints busy:revert during a conflicting revert", () => {
		gitOk(repo, "checkout", "-q", "-b", "history");
		commit("story.txt", "one\n", "one");
		const first = gitOk(repo, "rev-parse", "HEAD");
		commit("story.txt", "two\n", "two");

		expect(git(repo, "revert", "--no-edit", first).code).not.toBe(0);

		expect(check(repo)).toEqual({ code: 0, out: "busy:revert", err: "" });
	});

	test("finds the state of a linked worktree whose git directory is elsewhere", () => {
		gitOk(repo, "checkout", "-q", "-b", "other");
		commit("shared.txt", "other\n", "other change");
		gitOk(repo, "checkout", "-q", "main");
		const linked = join(base, "linked worktree");
		gitOk(repo, "worktree", "add", "-q", "-b", "linked", linked, "main");

		writeFileSync(join(linked, "shared.txt"), "linked\n");
		gitOk(linked, "add", "shared.txt");
		gitOk(linked, "commit", "-q", "-m", "linked change");

		expect(git(linked, "merge", "other").code).not.toBe(0);

		expect(check(linked)).toEqual({ code: 0, out: "busy:merge", err: "" });
	});

	test("reports an error and exits 2 for a missing folder or a non-repository", () => {
		const missing = check(join(base, "missing"));
		expect(missing.code).toBe(2);
		expect(missing.out).toBe("");
		expect(missing.err).toContain("error:");

		const plain = join(base, "plain");
		mkdirSync(plain);
		const notRepo = check(plain);
		expect(notRepo.code).toBe(2);
		expect(notRepo.err).toContain("error:");
	});

	test("exits 64 for a wrong command line", () => {
		const noArgs = run(["bash", SCRIPT], repo);
		expect(noArgs.code).toBe(64);
		expect(noArgs.err).toContain("usage:");

		const tooMany = run(["bash", SCRIPT, repo, repo], repo);
		expect(tooMany.code).toBe(64);
	});
});
