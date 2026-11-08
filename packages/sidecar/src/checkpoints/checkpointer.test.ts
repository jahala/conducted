/**
 * @feature GIT-10 Checkpointer: save, restore and diff a worktree with private refs
 * Owns: bin/checkpointer.sh, driven here against real temporary repositories.
 * Behaviour: research/conductor/native-and-sidecar-map.md C1 and services-map.md 3.12.2.
 * Test first: save a, edit a file, save b, `diff a b -- --name-status` lists exactly that file,
 * and `restore a` brings the content back without touching another file.
 *
 * The script lives in bin/, which `pnpm test` does not scan. This test sits with the checkpoint
 * code that calls the script, so CI runs it.
 *
 * Every repository here turns automatic maintenance and gc off (initRepo). A `git commit` otherwise
 * starts `git maintenance run --auto --detach` in its own session, outside the process group the
 * kill tests watch and outside the test's own control, and that process writes a lock file into the
 * repository. With those settings no git process outlives the commit that started it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../../bin/checkpointer.sh");
const REAL_GIT = Bun.which("git");
if (!REAL_GIT) throw new Error("git is not on PATH");

interface Run {
	code: number | null;
	out: string;
	err: string;
}

function baseEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) env[key] = value;
	}
	return env;
}

const ENV: Record<string, string> = {
	...baseEnv(),
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.invalid",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.invalid",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
};

let base = "";
let repo = "";

function run(command: string[], cwd: string, extraEnv: Record<string, string> = {}): Run {
	const result = Bun.spawnSync(command, {
		cwd,
		env: { ...ENV, ...extraEnv },
		stdout: "pipe",
		stderr: "pipe",
	});
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

/**
 * Make a repository the tests own, with automatic maintenance and gc off. Left to itself, `git
 * commit` starts a detached `git maintenance run --auto --detach` in a new session; it is outside
 * the process group the kill tests watch, it runs after the test can see it, and it writes into the
 * repository. Turning it off means no git process outlives the commit that started it.
 */
function initRepo(dir: string): void {
	gitOk(dir, "init", "-q", "-b", "main");
	gitOk(dir, "config", "gc.auto", "0");
	gitOk(dir, "config", "gc.autoDetach", "false");
	gitOk(dir, "config", "maintenance.auto", "false");
}

function save(cwd: string, ...args: string[]): Run {
	return run(["bash", SCRIPT, "save", ...args], cwd);
}

function saveWithEnv(cwd: string, env: Record<string, string>, ...args: string[]): Run {
	return run(["bash", SCRIPT, "save", ...args], cwd, env);
}

function restore(cwd: string, id: string): Run {
	return run(["bash", SCRIPT, "restore", id], cwd);
}

function diff(cwd: string, ...args: string[]): Run {
	return run(["bash", SCRIPT, "diff", ...args], cwd);
}

function write(file: string, text: string): void {
	const full = join(repo, file);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, text);
}

function commitAll(message: string): void {
	gitOk(repo, "add", "-A");
	gitOk(repo, "commit", "-q", "-m", message);
}

function checkpointMessage(id: string): string {
	return gitOk(repo, "cat-file", "commit", `refs/conducted/checkpoints/${id}`);
}

function refExists(id: string): boolean {
	return (
		git(repo, "show-ref", "--verify", "--quiet", `refs/conducted/checkpoints/${id}`).code === 0
	);
}

function writeGitWrapper(dir: string, body: string): void {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "git");
	writeFileSync(path, `#!/bin/sh\n${body}\nexec "${REAL_GIT}" "$@"\n`);
	chmodSync(path, 0o755);
}

/** Put main and a branch named "other" on conflicting edits of shared.txt. */
function diverge(): void {
	gitOk(repo, "checkout", "-q", "-b", "other");
	write("shared.txt", "other\n");
	commitAll("other change");
	gitOk(repo, "checkout", "-q", "main");
	write("shared.txt", "main\n");
	commitAll("main change");
}

/** Whether any process of the group led by `pid` is still running. */
function groupRuns(pid: number): boolean {
	try {
		process.kill(-pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Waits until no process of the group led by `pid` runs, or the deadline passes. */
async function groupEnds(pid: number, withinMs: number): Promise<boolean> {
	const deadline = Date.now() + withinMs;
	while (groupRuns(pid)) {
		if (Date.now() > deadline) return false;
		await Bun.sleep(10);
	}
	return true;
}

/** Stops whatever is left of the group led by `pid`, so no process outlives its test. */
function stopGroup(pid: number): void {
	if (groupRuns(pid)) process.kill(-pid, "SIGKILL");
}

/**
 * Start a save that blocks in `git add`, then send `signal` to its process group, or only to the
 * script itself (as the sidecar does), whose git steps must then be stopped by the script.
 */
async function expectTerminatedDuringSave(
	signal: "SIGTERM" | "SIGINT",
	target: "group" | "script" = "group",
): Promise<void> {
	const wrapper = join(base, "wrapper");
	const ready = join(base, "ready");
	writeGitWrapper(
		wrapper,
		`case " $* " in
  *" add "*)
    if [ -n "\${GIT_INDEX_FILE:-}" ]; then
      touch "${ready}"
      sleep 10
    fi
    ;;
esac`,
	);

	const child = Bun.spawn(["bash", SCRIPT, "save", "--id", "slow"], {
		cwd: repo,
		env: { ...ENV, PATH: `${wrapper}:${ENV.PATH ?? ""}` },
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	});

	const deadline = Date.now() + 10_000;
	while (!existsSync(ready)) {
		if (Date.now() > deadline) {
			process.kill(-child.pid, "SIGKILL");
			throw new Error("save never reached its temp index");
		}
		await Bun.sleep(10);
	}

	try {
		process.kill(target === "group" ? -child.pid : child.pid, signal);
		expect(await child.exited).toBe(143);
		expect(refExists("slow")).toBe(false);
		// The script's git step runs in the script's process group; once the script is gone, nothing
		// of that group may still run, or it keeps writing into the repository after the test.
		expect(await groupEnds(child.pid, 2_000)).toBe(true);
	} finally {
		stopGroup(child.pid);
	}

	const tmpRoot = join(gitOk(repo, "rev-parse", "--absolute-git-dir"), "conducted-checkpoint-tmp");
	expect(existsSync(tmpRoot) ? readdirSync(tmpRoot) : []).toEqual([]);
}

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "git-10-"));
	repo = join(base, "repo with spaces");
	mkdirSync(repo);
	initRepo(repo);
	write("base.txt", "base\n");
	commitAll("base");
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("GIT-10 checkpointer.sh", () => {
	test("a commit in the test repository starts no detached git maintenance", () => {
		const trace = join(base, "trace.json");
		const committed = run(["git", "commit", "--allow-empty", "-m", "trace"], repo, {
			GIT_TRACE2_EVENT: trace,
		});

		expect(committed.code).toBe(0);
		// Without initRepo's settings, git starts `maintenance run --auto --detach` after every
		// commit. It detaches into its own session, writes the repository's lock file and is
		// invisible to the tests' process-group checks.
		expect(readFileSync(trace, "utf8")).not.toContain('"maintenance"');
	});

	test("saves two states, diffs them, and restores the first without touching other files", () => {
		write("one.txt", "one\n");
		write("two.txt", "two\n");
		commitAll("files");

		expect(save(repo, "--id", "a")).toEqual({ code: 0, out: "a", err: "" });
		expect(refExists("a")).toBe(true);

		write("one.txt", "changed\n");
		expect(save(repo, "--id", "b")).toEqual({ code: 0, out: "b", err: "" });

		const changes = diff(repo, "a", "b", "--", "--name-status");
		expect(changes.code).toBe(0);
		expect(changes.out.split("\n")).toEqual(["M\tone.txt"]);

		const untouched = statSync(join(repo, "two.txt")).mtimeMs;
		expect(restore(repo, "a")).toEqual({
			code: 0,
			out: "restored checkpoint: a",
			err: "",
		});
		expect(readFileSync(join(repo, "one.txt"), "utf8")).toBe("one\n");
		expect(statSync(join(repo, "two.txt")).mtimeMs).toBe(untouched);
	});

	test("handles file names with spaces, newlines and non-ASCII characters", () => {
		const names = ["file with space.txt", "line\nbreak.txt", "naïve-é.txt"];
		for (const name of names) write(name, `before:${name}\n`);
		commitAll("odd names");
		expect(save(repo, "--id", "odd")).toEqual({ code: 0, out: "odd", err: "" });

		for (const name of names) writeFileSync(join(repo, name), `after:${name}\n`);
		expect(restore(repo, "odd")).toEqual({
			code: 0,
			out: "restored checkpoint: odd",
			err: "",
		});
		for (const name of names) {
			expect(readFileSync(join(repo, name), "utf8")).toBe(`before:${name}\n`);
		}

		for (const name of names) writeFileSync(join(repo, name), `after:${name}\n`);
		const changed = diff(repo, "odd", "current", "--", "--name-only", "-z");
		expect(changed.code).toBe(0);
		const listed = changed.out.split("\0").filter(Boolean);
		for (const name of names) expect(listed).toContain(name);
	});

	test("leaves HEAD, the index and the working files untouched when saving", () => {
		write("tracked.txt", "base\n");
		commitAll("tracked");
		write("tracked.txt", "working\n");
		write("staged.txt", "staged\n");
		gitOk(repo, "add", "staged.txt");
		write("untracked.txt", "new\n");

		const head = gitOk(repo, "rev-parse", "HEAD");
		const index = gitOk(repo, "write-tree");
		const trackedMtime = statSync(join(repo, "tracked.txt")).mtimeMs;

		expect(save(repo, "--id", "a").code).toBe(0);

		expect(gitOk(repo, "rev-parse", "HEAD")).toBe(head);
		expect(gitOk(repo, "write-tree")).toBe(index);
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("working\n");
		expect(statSync(join(repo, "tracked.txt")).mtimeMs).toBe(trackedMtime);
		expect(gitOk(repo, "ls-files", "--others", "--exclude-standard")).toBe("untracked.txt");
	});

	test("makes a neutral commit naming the head, the index tree and the worktree tree", () => {
		write(".gitignore", "ignored.txt\n");
		write("tracked.txt", "base\n");
		commitAll("base");
		write("staged.txt", "staged version\n");
		gitOk(repo, "add", "staged.txt");
		write("staged.txt", "working version\n");
		write("untracked.txt", "new\n");
		write("ignored.txt", "ignored\n");

		expect(save(repo, "--id", "snap").code).toBe(0);

		const message = checkpointMessage("snap");
		const head = gitOk(repo, "rev-parse", "HEAD");
		expect(message).toContain(`head ${head}`);
		expect(message).toContain("author Checkpointer <checkpointer@noreply>");
		expect(message).toContain("committer Checkpointer <checkpointer@noreply>");
		expect(message).toContain("created ");

		const indexTree = /^index-tree (.+)$/m.exec(message)?.[1];
		const worktreeTree = /^worktree-tree (.+)$/m.exec(message)?.[1];
		if (!indexTree || !worktreeTree) throw new Error("checkpoint commit is missing a tree");
		expect(gitOk(repo, "show", `${indexTree}:staged.txt`)).toBe("staged version");
		expect(gitOk(repo, "show", `${worktreeTree}:staged.txt`)).toBe("working version");
		const worktreeFiles = gitOk(repo, "ls-tree", "-r", "--name-only", worktreeTree).split("\n");
		expect(worktreeFiles).toContain("untracked.txt");
		expect(worktreeFiles).not.toContain("ignored.txt");
	});

	test("names a snapshot cp-<UTC timestamp> when no id is given", () => {
		const saved = save(repo);
		expect(saved.code).toBe(0);
		expect(saved.out).toMatch(/^cp-\d{8}T\d{6}Z$/);
		expect(refExists(saved.out)).toBe(true);
	});

	test("refuses to overwrite an existing id unless --force is given", () => {
		expect(save(repo, "--id", "dup").code).toBe(0);
		const first = gitOk(repo, "rev-parse", "refs/conducted/checkpoints/dup");

		const again = save(repo, "--id", "dup");
		expect(again.code).toBe(1);
		expect(again.err).toContain("already exists");
		expect(gitOk(repo, "rev-parse", "refs/conducted/checkpoints/dup")).toBe(first);

		write("later.txt", "later\n");
		expect(save(repo, "--id", "dup", "--force").code).toBe(0);
		expect(gitOk(repo, "rev-parse", "refs/conducted/checkpoints/dup")).not.toBe(first);
	});

	test("accepts the archive checkpoint id and stores it under a private ref", () => {
		const id = "conductor-archive-local-42";
		expect(save(repo, "--id", id).code).toBe(0);
		expect(refExists(id)).toBe(true);
		expect(gitOk(repo, "for-each-ref", "--format=%(refname)", "refs/conducted/checkpoints/")).toBe(
			`refs/conducted/checkpoints/${id}`,
		);
	});

	test("exits 101 while a merge or rebase is running", () => {
		diverge();
		expect(git(repo, "merge", "other").code).not.toBe(0);

		const duringMerge = save(repo, "--id", "merge");
		expect(duringMerge.code).toBe(101);
		expect(duringMerge.err).toContain("skipped");
		expect(refExists("merge")).toBe(false);
		gitOk(repo, "merge", "--abort");

		expect(git(repo, "rebase", "other").code).not.toBe(0);
		expect(save(repo, "--id", "rebase").code).toBe(101);
		gitOk(repo, "rebase", "--abort");
	});

	test("exits 102 when the index has unresolved conflicts but git is not busy", () => {
		diverge();
		expect(git(repo, "merge", "other").code).not.toBe(0);

		// Remove the merge marker so only unmerged index entries remain. Without it the busy
		// check answers clean and the conflict check is the one that refuses the save.
		const gitDir = gitOk(repo, "rev-parse", "--absolute-git-dir");
		rmSync(join(gitDir, "MERGE_HEAD"));

		const result = save(repo, "--id", "conflict");
		expect(result.code).toBe(102);
		expect(result.err).toContain("conflicts");
		expect(refExists("conflict")).toBe(false);
	});

	test("refuses with exit 103 when the git top level is above the current folder", () => {
		const sub = join(repo, "sub");
		mkdirSync(sub);
		const result = save(sub, "--id", "sub");

		expect(result.code).toBe(103);
		expect(result.err).toContain("refused");
		expect(refExists("sub")).toBe(false);
	});

	test("diff and restore refuse with exit 103 from a sub-folder", () => {
		write("tracked.txt", "one\n");
		commitAll("one");
		expect(save(repo, "--id", "a").code).toBe(0);
		write("tracked.txt", "two\n");

		const sub = join(repo, "sub");
		mkdirSync(sub);

		const compared = diff(sub, "a", "current");
		expect(compared.code).toBe(103);
		expect(compared.err).toContain("refused");

		const restored = restore(sub, "a");
		expect(restored.code).toBe(103);
		expect(restored.err).toContain("refused");

		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("two\n");
	});

	test("refuses an id that is not a legal git ref name with exit 64", () => {
		for (const id of ["a b", "a..b", "-a", "x.lock", ""]) {
			const result = save(repo, "--id", id);
			expect(result.code).toBe(64);
			expect(result.err).toContain("invalid checkpoint id");
		}
		expect(gitOk(repo, "for-each-ref", "--format=%(refname)", "refs/conducted/checkpoints/")).toBe(
			"",
		);
	});

	test("refuses an id that would collide with an existing ref with exit 64", () => {
		expect(save(repo, "--id", "a").code).toBe(0);

		const child = save(repo, "--id", "a/b");
		expect(child.code).toBe(64);
		expect(child.err).toContain("invalid checkpoint id");
		expect(refExists("a/b")).toBe(false);

		expect(save(repo, "--id", "c/d").code).toBe(0);
		const parent = save(repo, "--id", "c");
		expect(parent.code).toBe(64);
		expect(parent.err).toContain("invalid checkpoint id");
		expect(refExists("c")).toBe(false);
	});

	test("saves an unborn HEAD and refuses to restore that snapshot", () => {
		const empty = join(base, "empty");
		mkdirSync(empty);
		initRepo(empty);
		writeFileSync(join(empty, "first.txt"), "first\n");

		const saved = save(empty, "--id", "unborn");
		expect(saved.code).toBe(0);
		const message = gitOk(empty, "cat-file", "commit", "refs/conducted/checkpoints/unborn");
		expect(message).toContain(`head ${"0".repeat(40)}`);

		const result = restore(empty, "unborn");
		expect(result.code).toBe(1);
		expect(result.err).toContain("unborn");
	});

	test("restore rewrites only changed files, removes untracked files and keeps ignored ones", () => {
		write(".gitignore", "ignored.txt\n");
		write("changed.txt", "before\n");
		write("untouched.txt", "same\n");
		commitAll("base");
		write("ignored.txt", "ignored before\n");
		expect(save(repo, "--id", "a").code).toBe(0);
		const untouched = statSync(join(repo, "untouched.txt")).mtimeMs;

		write("changed.txt", "after\n");
		write("untracked.txt", "stray\n");
		write("ignored.txt", "ignored after\n");

		expect(restore(repo, "a")).toEqual({ code: 0, out: "restored checkpoint: a", err: "" });
		expect(readFileSync(join(repo, "changed.txt"), "utf8")).toBe("before\n");
		expect(existsSync(join(repo, "untracked.txt"))).toBe(false);
		expect(readFileSync(join(repo, "ignored.txt"), "utf8")).toBe("ignored after\n");
		expect(statSync(join(repo, "untouched.txt")).mtimeMs).toBe(untouched);
	});

	test("restore restores the saved index", () => {
		write("staged.txt", "base\n");
		commitAll("base");

		write("staged.txt", "staged version\n");
		gitOk(repo, "add", "staged.txt");
		write("staged.txt", "working version\n");
		expect(save(repo, "--id", "a").code).toBe(0);

		gitOk(repo, "reset", "-q", "--hard", "HEAD");
		expect(readFileSync(join(repo, "staged.txt"), "utf8")).toBe("base\n");

		expect(restore(repo, "a")).toEqual({ code: 0, out: "restored checkpoint: a", err: "" });
		expect(readFileSync(join(repo, "staged.txt"), "utf8")).toBe("working version\n");
		expect(gitOk(repo, "show", ":staged.txt")).toBe("staged version");
		expect(gitOk(repo, "diff", "--cached", "--name-only").split("\n")).toContain("staged.txt");
	});

	test("restore moves HEAD back after a new commit", () => {
		write("tracked.txt", "one\n");
		commitAll("one");
		const saved = gitOk(repo, "rev-parse", "HEAD");
		expect(save(repo, "--id", "a").code).toBe(0);

		write("tracked.txt", "two\n");
		commitAll("two");
		expect(gitOk(repo, "rev-parse", "HEAD")).not.toBe(saved);

		expect(restore(repo, "a")).toEqual({ code: 0, out: "restored checkpoint: a", err: "" });
		expect(gitOk(repo, "rev-parse", "HEAD")).toBe(saved);
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("one\n");
	});

	test("restore moves HEAD back after another branch is checked out", () => {
		write("tracked.txt", "one\n");
		commitAll("one");
		const saved = gitOk(repo, "rev-parse", "HEAD");
		expect(save(repo, "--id", "a").code).toBe(0);

		gitOk(repo, "checkout", "-q", "-b", "other");
		write("tracked.txt", "other\n");
		write("other.txt", "other\n");
		commitAll("other");

		expect(restore(repo, "a")).toEqual({ code: 0, out: "restored checkpoint: a", err: "" });
		expect(gitOk(repo, "branch", "--show-current")).toBe("other");
		expect(gitOk(repo, "rev-parse", "HEAD")).toBe(saved);
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("one\n");
		expect(existsSync(join(repo, "other.txt"))).toBe(false);
	});

	test("restore clears a merge in progress", () => {
		write("shared.txt", "base\n");
		commitAll("base");
		const saved = gitOk(repo, "rev-parse", "HEAD");
		expect(save(repo, "--id", "a").code).toBe(0);

		diverge();
		expect(git(repo, "merge", "other").code).not.toBe(0);
		const gitDir = gitOk(repo, "rev-parse", "--absolute-git-dir");
		expect(existsSync(join(gitDir, "MERGE_HEAD"))).toBe(true);

		expect(restore(repo, "a")).toEqual({ code: 0, out: "restored checkpoint: a", err: "" });
		expect(existsSync(join(gitDir, "MERGE_HEAD"))).toBe(false);
		expect(gitOk(repo, "rev-parse", "HEAD")).toBe(saved);
		expect(readFileSync(join(repo, "shared.txt"), "utf8")).toBe("base\n");
	});

	test("diff compares two checkpoints and a checkpoint against the current state", () => {
		write("a.txt", "a\n");
		commitAll("a");
		expect(save(repo, "--id", "one").code).toBe(0);

		write("a.txt", "b\n");
		expect(save(repo, "--id", "two").code).toBe(0);
		expect(diff(repo, "one", "two", "--", "--name-status").out).toBe("M\ta.txt");

		write("a.txt", "c\n");
		write("new.txt", "new\n");
		const current = diff(repo, "one", "current", "--", "--name-status", "-z");
		expect(current.code).toBe(0);
		const names = current.out.split("\0").filter(Boolean);
		expect(names).toContain("a.txt");
		expect(names).toContain("new.txt");
	});

	test("diff compares against the current state on an unborn HEAD", () => {
		const empty = join(base, "unborn-diff");
		mkdirSync(empty);
		initRepo(empty);
		expect(save(empty, "--id", "empty").code).toBe(0);

		writeFileSync(join(empty, "first.txt"), "first\n");
		const result = run(["bash", SCRIPT, "diff", "empty", "current", "--", "--name-status"], empty);
		expect(result).toEqual({ code: 0, out: "A\tfirst.txt", err: "" });
	});

	test("diff fails when a checkpoint does not exist", () => {
		const result = diff(repo, "missing", "current");
		expect(result.code).toBe(1);
		expect(result.err).toContain("does not exist");
	});

	test("reports an error and exits 1 outside a git worktree", () => {
		const plain = join(base, "plain");
		mkdirSync(plain);
		const result = save(plain, "--id", "x");
		expect(result.code).toBe(1);
		expect(result.err).toContain("git");
	});

	test("a save keeps its temp index in a folder that carries the owner pid", () => {
		const wrapper = join(base, "wrapper");
		const capture = join(base, "capture");
		mkdirSync(capture);
		writeGitWrapper(
			wrapper,
			`case " $* " in
  *" add "*)
    if [ -n "\${GIT_INDEX_FILE:-}" ] && [ -d "$(dirname "$GIT_INDEX_FILE")" ]; then
      cp -R "$(dirname "$GIT_INDEX_FILE")" "${capture}/tmp"
    fi
    ;;
esac`,
		);

		const result = saveWithEnv(repo, { PATH: `${wrapper}:${ENV.PATH ?? ""}` }, "--id", "owner");
		expect(result.code).toBe(0);

		const owner = join(capture, "tmp", "owner-pid");
		expect(existsSync(owner)).toBe(true);
		expect(readFileSync(owner, "utf8").trim()).toMatch(/^\d+$/);

		// The run removed its own temp folder; only the shared parent remains.
		const tmpRoot = join(
			gitOk(repo, "rev-parse", "--absolute-git-dir"),
			"conducted-checkpoint-tmp",
		);
		expect(readdirSync(tmpRoot)).toEqual([]);
	});

	test("prunes temp folders older than 60 minutes whose owner is gone, and only those", () => {
		const gitDir = gitOk(repo, "rev-parse", "--absolute-git-dir");
		const tmpRoot = join(gitDir, "conducted-checkpoint-tmp");
		const stale = join(tmpRoot, "stale");
		const fresh = join(tmpRoot, "fresh");
		const live = join(tmpRoot, "live");
		for (const dir of [stale, fresh, live]) mkdirSync(dir, { recursive: true });

		const dead = Bun.spawnSync(["sh", "-c", "echo $$"]).stdout.toString().trim();
		writeFileSync(join(stale, "owner-pid"), `${dead}\n`);
		writeFileSync(join(fresh, "owner-pid"), `${dead}\n`);
		writeFileSync(join(live, "owner-pid"), `${process.pid}\n`);

		const old = new Date(Date.now() - 90 * 60 * 1000);
		utimesSync(stale, old, old);
		utimesSync(live, old, old);

		const bin = join(base, "bin");
		const trashed = join(base, "trashed");
		mkdirSync(bin);
		mkdirSync(trashed);
		writeFileSync(join(bin, "trash"), `#!/bin/sh\nmv "$1" "${trashed}/$(basename "$1")"\n`);
		chmodSync(join(bin, "trash"), 0o755);

		const result = saveWithEnv(repo, { PATH: `${bin}:${ENV.PATH ?? ""}` }, "--id", "pruned");
		expect(result.code).toBe(0);

		expect(existsSync(stale)).toBe(false);
		expect(existsSync(join(trashed, "stale"))).toBe(true);
		expect(existsSync(fresh)).toBe(true);
		expect(existsSync(live)).toBe(true);
		expect(readdirSync(tmpRoot).sort()).toEqual(["fresh", "live"]);
	});

	test("leaves a stale temp folder in place and warns when trash is not installed", () => {
		const gitDir = gitOk(repo, "rev-parse", "--absolute-git-dir");
		const tmpRoot = join(gitDir, "conducted-checkpoint-tmp");
		const stale = join(tmpRoot, "stale");
		mkdirSync(stale, { recursive: true });
		const dead = Bun.spawnSync(["sh", "-c", "echo $$"]).stdout.toString().trim();
		writeFileSync(join(stale, "owner-pid"), `${dead}\n`);
		const old = new Date(Date.now() - 90 * 60 * 1000);
		utimesSync(stale, old, old);

		const bin = join(base, "bin-without-trash");
		mkdirSync(bin);
		for (const name of [
			"bash",
			"cat",
			"date",
			"dirname",
			"find",
			"git",
			"mkdir",
			"mktemp",
			"sed",
		]) {
			const found = Bun.which(name);
			if (!found) throw new Error(`${name} is not on PATH`);
			symlinkSync(found, join(bin, name));
		}

		const result = run(["/bin/bash", SCRIPT, "save", "--id", "no-trash"], repo, { PATH: bin });
		expect(result.code).toBe(0);
		expect(result.out).toBe("no-trash");
		expect(result.err).toContain("trash");
		expect(existsSync(stale)).toBe(true);
	});

	test("exits 143 and removes its temp folder on SIGTERM", async () => {
		await expectTerminatedDuringSave("SIGTERM");
	});

	test("exits 143 and removes its temp folder on SIGINT", async () => {
		await expectTerminatedDuringSave("SIGINT");
	});

	test("exits 143 and stops its git step when only the script gets SIGTERM", async () => {
		await expectTerminatedDuringSave("SIGTERM", "script");
	});
});
