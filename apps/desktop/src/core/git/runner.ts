/**
 * @feature GIT-01 Git runner over Platform.shell
 * Owns: running `GitCommand` values (commands.ts, gh-commands.ts): the login-shell environment,
 * lock retries, per-command timeouts, the HTTPS fallback, and the in-process locks.
 * Behaviour: services-map.md 3.0 (shell doors, timeouts, locking model, retry on git's own lock
 * errors), 3.6.2 (HTTPS fallback), 3.15 (the shell door in a remake).
 * Must handle: a process that ran but exited non-zero is a normal `Ok` (callers read the exit
 * code); a process that could not start or timed out is an `Err` (code `git_spawn` or
 * `shell_timeout`); retries on `index.lock` and "cannot lock ref" at 50, 100 and 200 ms; one
 * HTTPS retry when SSH is blocked and the command is marked `network`; the repo lock is taken
 * inside the worktree lock; a lock that is held longer than 10 s is logged, never aborted; the
 * caller can cancel by dropping the result (a late answer must not change state).
 * Our design choice: every command is `{ program, args }`, never a shell string, so there is no
 * quoting layer. `-c core.quotePath=false` is added for the program `git` only.
 * Test first: a command that fails once with "index.lock: File exists" is retried and then
 * returns its second result.
 */
import { appError, notImplemented, type Result } from "@conducted/shared";
import type { Shell, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "./commands.ts";
import { type KeyedMutex, repoLockKey, worktreeLockKey } from "./locks.ts";

export const GIT_LOCK_RETRY_DELAYS_MS = [50, 100, 200] as const;
export const LOCK_WARM_TIMEOUT_MS = 10_000;
/** Error code returned when a command exceeds its `timeoutMs`. */
export const SHELL_TIMEOUT_CODE = "shell_timeout";

/** True when git printed one of its own lock errors, which clear by themselves. */
export const isGitLockError = (stderr: string): boolean =>
	/Unable to create '.*\.lock': File exists/.test(stderr) ||
	/cannot lock ref '.*': is at [0-9a-f]+ but expected [0-9a-f]+/.test(stderr);

/** True when git could not reach the remote because port 22 is blocked. */
export const isSshBlockedError = (stderr: string): boolean =>
	/port 22|ssh: connect to host|kex_exchange_identification/.test(stderr);

/**
 * Environment for the one HTTPS retry: SSH remote URLs for github.com are rewritten to HTTPS and
 * credentials come from `gh auth git-credential`. Nothing is written to disk or config files.
 */
export const httpsFallbackEnv = (): Readonly<Record<string, string>> => ({
	GIT_TERMINAL_PROMPT: "0",
	GIT_CONFIG_COUNT: "3",
	GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf",
	GIT_CONFIG_VALUE_0: "git@github.com:",
	GIT_CONFIG_KEY_1: "url.https://github.com/.insteadOf",
	GIT_CONFIG_VALUE_1: "ssh://git@github.com/",
	GIT_CONFIG_KEY_2: "credential.https://github.com.helper",
	GIT_CONFIG_VALUE_2: "!gh auth git-credential",
});

export interface GitRunOptions {
	cwd: string;
	env?: Readonly<Record<string, string>>;
}

export interface GitRunner {
	/** Runs the command. `Ok` means the process ran, with any exit code. */
	run(command: GitCommand, options: GitRunOptions): Promise<Result<ShellOutput>>;
	/**
	 * Like `run`, but an exit code outside `command.okExitCodes` (default `[0]`) becomes an `Err`
	 * with code `git_failed` and the trimmed stderr as the message.
	 */
	runChecked(command: GitCommand, options: GitRunOptions): Promise<Result<ShellOutput>>;
	/** Output of `runChecked` with trailing whitespace removed. */
	stdout(command: GitCommand, options: GitRunOptions): Promise<Result<string>>;
	withWorktreeLock<T>(worktreePath: string, work: () => Promise<T>): Promise<T>;
	withRepoLock<T>(repoRootPath: string, work: () => Promise<T>): Promise<T>;
}

export interface ShellGitRunnerDeps {
	shell: Shell;
	locks: KeyedMutex;
	/** Waits `ms`. A parameter so tests do not sleep. */
	sleep: (ms: number) => Promise<void>;
	log: (level: "warn" | "info", message: string) => void;
}

export class ShellGitRunner implements GitRunner {
	readonly #deps: ShellGitRunnerDeps;

	constructor(deps: ShellGitRunnerDeps) {
		this.#deps = deps;
	}

	run(_command: GitCommand, _options: GitRunOptions): Promise<Result<ShellOutput>> {
		return notImplemented("GIT-01");
	}

	runChecked(_command: GitCommand, _options: GitRunOptions): Promise<Result<ShellOutput>> {
		return notImplemented("GIT-01");
	}

	stdout(_command: GitCommand, _options: GitRunOptions): Promise<Result<string>> {
		return notImplemented("GIT-01");
	}

	withWorktreeLock<T>(worktreePath: string, work: () => Promise<T>): Promise<T> {
		return this.#deps.locks.run(worktreeLockKey(worktreePath), work);
	}

	withRepoLock<T>(repoRootPath: string, work: () => Promise<T>): Promise<T> {
		return this.#deps.locks.run(repoLockKey(repoRootPath), work);
	}
}

/** Builds the error for a command that exited with a code it did not list as success. */
export const failedCommandError = (command: GitCommand, output: ShellOutput) =>
	appError(
		"git_failed",
		output.stderr.trim() ||
			`${command.program} ${command.args[0] ?? ""} exited with code ${output.exitCode}`,
	);
