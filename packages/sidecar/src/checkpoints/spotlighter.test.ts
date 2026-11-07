/**
 * @feature RUN-08 Spotlighter: mirror a workspace into the repo root on every change
 * Owns: bin/spotlighter.sh, driven here against a real root clone and a real worktree.
 * Behaviour: research/conductor/native-and-sidecar-map.md C3 and services-map.md 5A.2.3.
 * Test first: in a root clone and a worktree of it, start the script, write a file in the
 * worktree, and see the same file appear in the root; stop it and see it exit 143.
 *
 * The script lives in bin/, which `pnpm test` does not scan. This test sits with the checkpoint
 * code whose script the spotlighter runs, so CI runs it on every push.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

const SCRIPT = join(import.meta.dir, "../../../../bin/spotlighter.sh");
const CHECKPOINTER = join(import.meta.dir, "../../../../bin/checkpointer.sh");
if (!Bun.which("git")) throw new Error("git is not on PATH");
if (!Bun.which("bash")) throw new Error("bash is not on PATH");

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

const GIT_ENV: Record<string, string> = {
	...baseEnv(),
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.invalid",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.invalid",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
};

let base = "";
let root = "";
let workspace = "";
let triggerPath = "";
let argsPath = "";
let batchesPath = "";
let checkpointerLog = "";
const started: Subprocess[] = [];

function git(cwd: string, ...args: string[]): Run {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		env: GIT_ENV,
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString().trim(),
		err: result.stderr.toString().trim(),
	};
}

function gitOk(cwd: string, ...args: string[]): string {
	const result = git(cwd, ...args);
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.err}`);
	return result.out;
}

function write(path: string, text: string): void {
	writeFileSync(path, text);
}

function lines(path: string): string[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line !== "");
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
	const from = Date.now();
	while (Date.now() - from < timeoutMs) {
		if (check()) return;
		await Bun.sleep(20);
	}
	throw new Error(`timed out waiting for ${what}`);
}

/** A watchexec stand-in: it records its arguments, waits for a trigger, then runs the job. */
function writeWatcher(): string {
	const dir = join(base, "watcher-bin");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "watchexec");
	write(
		path,
		`#!/usr/bin/env bash
set -u
printf '%s\\n' "$@" > "$CONDUCTED_TEST_WATCHEXEC_ARGS"
command=()
seen_separator=0
for arg in "$@"; do
  if [ "$seen_separator" -eq 1 ]; then
    command+=("$arg")
  elif [ "$arg" = "--" ]; then
    seen_separator=1
  fi
done
while :; do
  while [ ! -f "$CONDUCTED_TEST_TRIGGER" ]; do
    sleep 0.05
  done
  mv "$CONDUCTED_TEST_TRIGGER" "$CONDUCTED_TEST_TRIGGER.seen"
  "\${command[@]}" || true
  printf 'batch\\n' >> "$CONDUCTED_TEST_BATCHES"
done
`,
	);
	chmodSync(path, 0o755);
	return dir;
}

function writeFakeCheckpointer(body: string): string {
	const path = join(base, "fake-checkpointer.sh");
	write(path, `#!/usr/bin/env bash\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

function scriptEnv(overrides: Record<string, string> = {}): Record<string, string> {
	return {
		...GIT_ENV,
		PATH: `${join(base, "watcher-bin")}:${process.env.PATH ?? ""}`,
		CONDUCTED_CHECKPOINTER_PATH: CHECKPOINTER,
		CONDUCTED_WATCHEXEC_PATH: join(base, "watcher-bin", "watchexec"),
		CONDUCTED_ROOT_PATH: root,
		CONDUCTED_TEST_TRIGGER: triggerPath,
		CONDUCTED_TEST_WATCHEXEC_ARGS: argsPath,
		CONDUCTED_TEST_BATCHES: batchesPath,
		CONDUCTED_TEST_CHECKPOINTER_LOG: checkpointerLog,
		...overrides,
	};
}

function startScript(overrides: Record<string, string> = {}): Subprocess {
	const proc = Bun.spawn(["bash", SCRIPT], {
		cwd: workspace,
		env: scriptEnv(overrides),
		stdout: "ignore",
		stderr: "ignore",
	});
	started.push(proc);
	return proc;
}

function runOnce(env: Record<string, string>): Run {
	const result = Bun.spawnSync(["bash", SCRIPT], {
		cwd: workspace,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString().trim(),
		err: result.stderr.toString().trim(),
	};
}

async function stop(proc: Subprocess): Promise<number> {
	proc.kill("SIGTERM");
	return await proc.exited;
}

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "run-08-"));
	root = join(base, "root");
	workspace = join(base, "workspace");
	triggerPath = join(base, "trigger");
	argsPath = join(base, "watchexec-args");
	batchesPath = join(base, "batches");
	checkpointerLog = join(base, "checkpointer.log");

	mkdirSync(root);
	gitOk(root, "init", "-q", "-b", "main");
	write(join(root, "README.md"), "root\n");
	gitOk(root, "add", "-A");
	gitOk(root, "commit", "-q", "-m", "initial");
	gitOk(root, "worktree", "add", "-q", "-b", "feature", workspace);
	writeWatcher();
});

afterEach(async () => {
	const pids = new Set(started.map((proc) => proc.pid));
	for (const proc of started.splice(0)) {
		if (proc.exitCode === null) proc.kill("SIGTERM");
		await proc.exited;
	}
	for (const pid of pids) {
		rmSync(`/tmp/conducted-spotlight-${pid}.log`, { force: true });
	}
	rmSync(base, { recursive: true, force: true });
});

describe("RUN-08 environment and prerequisites", () => {
	test("exits 1 and names every required environment variable that is missing", () => {
		for (const name of [
			"CONDUCTED_CHECKPOINTER_PATH",
			"CONDUCTED_WATCHEXEC_PATH",
			"CONDUCTED_ROOT_PATH",
		]) {
			const env = scriptEnv();
			delete env[name];
			const result = runOnce(env);
			expect(result.code).toBe(1);
			expect(result.err).toContain(`${name} is not set`);
		}
	});

	test("exits 1 when the checkpointer file or the root folder is missing", () => {
		const noCheckpointer = runOnce(
			scriptEnv({ CONDUCTED_CHECKPOINTER_PATH: join(base, "missing-checkpointer.sh") }),
		);
		expect(noCheckpointer.code).toBe(1);
		expect(noCheckpointer.err).toContain("CONDUCTED_CHECKPOINTER_PATH is not a file");

		const noRoot = runOnce(scriptEnv({ CONDUCTED_ROOT_PATH: join(base, "missing-root") }));
		expect(noRoot.code).toBe(1);
		expect(noRoot.err).toContain("CONDUCTED_ROOT_PATH is not a folder");
	});

	test("exits 1 when the watchexec path is not an executable file", () => {
		const missing = runOnce(
			scriptEnv({ CONDUCTED_WATCHEXEC_PATH: join(base, "missing-watchexec") }),
		);
		expect(missing.code).toBe(1);
		expect(missing.err).toContain("watchexec program is not executable");

		const bareName = runOnce(scriptEnv({ CONDUCTED_WATCHEXEC_PATH: "watchexec" }));
		expect(bareName.code).toBe(1);
		expect(bareName.err).toContain("must be an absolute path");
	});

	test("exits 64 on a command line argument", () => {
		const withArgument = Bun.spawnSync(["bash", SCRIPT, "extra"], {
			cwd: workspace,
			env: scriptEnv({ CONDUCTED_ROOT_PATH: join(base, "missing-root") }),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(withArgument.exitCode).toBe(64);
	});
});

describe("RUN-08 the sync loop", () => {
	test("runs the watchexec at the given path, passes its ignore rules, and mirrors changes into the root", async () => {
		const proc = startScript();

		await waitFor(() => existsSync(argsPath), "watchexec to start");
		const args = lines(argsPath);
		for (const expected of [
			"--shell=none",
			"--watch",
			".",
			"--project-origin",
			"--on-busy-update=queue",
			"--emit-events-to=environment",
			"--ignore",
			"*.tmp.*",
			".context/**",
			"--",
			"bash",
		]) {
			expect(args).toContain(expected);
		}

		write(join(workspace, "note.txt"), "first\n");
		write(triggerPath, "1");
		await waitFor(
			() =>
				existsSync(join(root, "note.txt")) &&
				readFileSync(join(root, "note.txt"), "utf8") === "first\n",
			"the first change to reach the root",
		);

		write(join(workspace, "note.txt"), "second\n");
		write(triggerPath, "1");
		await waitFor(() => lines(batchesPath).length === 2, "the second batch");
		await waitFor(
			() =>
				existsSync(join(root, "note.txt")) &&
				readFileSync(join(root, "note.txt"), "utf8") === "second\n",
			"the second change to reach the root",
		);

		const logPath = `/tmp/conducted-spotlight-${proc.pid}.log`;
		await waitFor(() => existsSync(logPath), "the log file");
		const code = await stop(proc);

		expect(code).toBe(143);
		await waitFor(
			() => existsSync(logPath) && readFileSync(logPath, "utf8").includes("spotlight: stopped"),
			"the stop line in the log file",
		);
		const log = readFileSync(logPath, "utf8");
		expect(log).toContain("spotlight: watching");
		expect(log).toContain("spotlight: change");
		expect(log).toContain("spotlight: stopped");
	});

	test("saves with the process checkpoint id and --force", async () => {
		const fake = writeFakeCheckpointer(
			`printf '%s\\n' "$*" >> "$CONDUCTED_TEST_CHECKPOINTER_LOG"\nexit 0`,
		);
		const proc = startScript({ CONDUCTED_CHECKPOINTER_PATH: fake });
		await waitFor(() => existsSync(argsPath), "watchexec to start");

		write(join(workspace, "note.txt"), "one\n");
		write(triggerPath, "1");
		await waitFor(() => lines(batchesPath).length === 1, "the first batch");

		expect(await stop(proc)).toBe(143);
		const saves = lines(checkpointerLog).filter((line) => line.startsWith("save "));
		expect(saves).toHaveLength(1);
		expect(saves[0]).toMatch(new RegExp(`^save --id cp-spotlight-\\d+-${proc.pid} --force$`));
	});

	test("stops with 143 on SIGINT as it does on SIGTERM", async () => {
		const proc = startScript();
		await waitFor(() => existsSync(argsPath), "watchexec to start");

		proc.kill("SIGINT");
		expect(await proc.exited).toBe(143);
	});

	test("skips quietly when the checkpoint save exits 101 and keeps watching", async () => {
		const fake = writeFakeCheckpointer(
			`printf '%s\\n' "$*" >> "$CONDUCTED_TEST_CHECKPOINTER_LOG"\nif [ "$1" = "save" ]; then exit 101; fi\nexit 0`,
		);
		const proc = startScript({ CONDUCTED_CHECKPOINTER_PATH: fake });
		await waitFor(() => existsSync(argsPath), "watchexec to start");

		write(join(workspace, "note.txt"), "one\n");
		write(triggerPath, "1");
		await waitFor(() => lines(batchesPath).length === 1, "the first batch");
		expect(lines(checkpointerLog).some((line) => line.startsWith("restore "))).toBe(false);
		expect(proc.exitCode).toBeNull();

		write(triggerPath, "1");
		await waitFor(() => lines(batchesPath).length === 2, "the second batch");
		expect(lines(checkpointerLog).filter((line) => line.startsWith("save "))).toHaveLength(2);
		expect(lines(checkpointerLog).some((line) => line.startsWith("restore "))).toBe(false);

		expect(await stop(proc)).toBe(143);
	});

	test("skips a failed save and keeps watching", async () => {
		const fake = writeFakeCheckpointer(
			`printf '%s\\n' "$*" >> "$CONDUCTED_TEST_CHECKPOINTER_LOG"\nif [ "$1" = "save" ]; then exit 1; fi\nexit 0`,
		);
		const proc = startScript({ CONDUCTED_CHECKPOINTER_PATH: fake });
		await waitFor(() => existsSync(argsPath), "watchexec to start");

		write(join(workspace, "note.txt"), "one\n");
		write(triggerPath, "1");
		await waitFor(() => lines(batchesPath).length === 1, "the first batch");
		expect(lines(checkpointerLog).some((line) => line.startsWith("restore "))).toBe(false);
		expect(proc.exitCode).toBeNull();

		write(triggerPath, "1");
		await waitFor(() => lines(batchesPath).length === 2, "the second batch");
		expect(lines(checkpointerLog).filter((line) => line.startsWith("save "))).toHaveLength(2);
		expect(await stop(proc)).toBe(143);
	});

	test("warns and keeps watching when the restore into the root fails", async () => {
		const fake = writeFakeCheckpointer(
			`printf '%s\\n' "$*" >> "$CONDUCTED_TEST_CHECKPOINTER_LOG"\nif [ "$1" = "restore" ]; then printf 'restore failed\\n' >&2; exit 1; fi\nexit 0`,
		);
		const proc = startScript({ CONDUCTED_CHECKPOINTER_PATH: fake });
		await waitFor(() => existsSync(argsPath), "watchexec to start");

		write(join(workspace, "note.txt"), "one\n");
		write(triggerPath, "1");
		await waitFor(() => lines(batchesPath).length === 1, "the first batch");
		expect(proc.exitCode).toBeNull();

		write(triggerPath, "1");
		await waitFor(() => lines(batchesPath).length === 2, "the second batch");
		expect(lines(checkpointerLog).filter((line) => line.startsWith("restore "))).toHaveLength(2);

		expect(await stop(proc)).toBe(143);
		const logPath = `/tmp/conducted-spotlight-${proc.pid}.log`;
		await waitFor(
			() => existsSync(logPath) && readFileSync(logPath, "utf8").includes("failed"),
			"the restore warning in the log file",
		);
		const log = readFileSync(logPath, "utf8");
		expect(log).toContain("restoring cp-spotlight-");
		expect(log).toContain("failed");
	});
});
