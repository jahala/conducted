/**
 * @feature GIT-01 Git runner over Platform.shell
 * Owns: running `GitCommand` values (commands.ts, gh-commands.ts): the login-shell environment,
 * lock retries, per-command timeouts, the HTTPS fallback, and the in-process locks.
 * Behaviour: services-map.md 3.0 (shell doors, timeouts, locking model, retry on git's own lock
 * errors), 3.6.2 (HTTPS fallback), 3.15 (the shell door in a remake).
 * Must handle: a process that ran but exited non-zero is a normal `Ok` (callers read the exit
 * code); a process that could not start is an `Err` with code `process_spawn`, and a timeout
 * keeps `shell_timeout`; retries on `index.lock` and "cannot lock ref" at 50, 100 and 200 ms; one
 * HTTPS retry when SSH is blocked and the command is marked `network`; the repo lock is taken
 * inside the worktree lock, and it cannot be taken any other way; a lock waited on longer than
 * 10 s is logged through the injected `sleep`, never aborted (the timer starts only when the lock
 * is already held, so a free lock leaves no timer behind); a login-shell PATH that cannot be read
 * is logged and tried again on the next command.
 * Our design choice: every command is `{ program, args }`, never a shell string, so there is no
 * quoting layer. `-c core.quotePath=false` is added for the program `git` only.
 * Xcode licence: this file detects the error and describes the toast (`xcodeLicenseToast`).
 * GIT-16 checks the licence at startup (`app/xcode-license-notice.ts`) and runs the accept
 * command from `services/system.ts`. A blocked SSH network returns `git_ssh_blocked`; the
 * calling screen shows that message.
 * Test first: a command that fails once with "index.lock: File exists" is retried and then
 * returns its second result.
 */
import { type AppError, appError, err, messageOf, ok, type Result } from "@conducted/shared";
import type { RunningCommand, Shell, ShellCommand, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "./commands.ts";
import { type KeyedMutex, repoLockKey, worktreeLockKey } from "./locks.ts";

export const GIT_LOCK_RETRY_DELAYS_MS = [50, 100, 200] as const;
export const LOCK_WARM_TIMEOUT_MS = 10_000;
export const LOCK_WARM_TIMEOUT_MESSAGE = "[git-lock] Git operation exceeded warm timeout";
/** Error code returned when a command exceeds its `timeoutMs`. */
export const SHELL_TIMEOUT_CODE = "shell_timeout";
/** Error code for a program that could not start, whichever program it is. */
export const PROCESS_SPAWN_CODE = "process_spawn";
/** Config that keeps git from escaping non-ASCII and control characters in paths. */
export const QUOTE_PATH_OFF_ARGS = ["-c", "core.quotePath=false"] as const;

/** Shown when SSH is blocked on this network and the HTTPS retry did not work either. */
export const SSH_BLOCKED_HTTPS_FAILED_MESSAGE =
	"Couldn't reach the Git remote: this network appears to block SSH, and HTTPS failed too.";
export const XCODE_LICENSE_TOAST_MESSAGE = "Xcode license is not accepted";
export const XCODE_LICENSE_FIX_ACTION = "Run for me";
export const XCODE_LICENSE_TOAST_MS = 15_000;

/** True when git printed one of its own lock errors, which clear by themselves. */
export const isGitLockError = (stderr: string): boolean =>
	/Unable to create '.*\.lock': File exists/.test(stderr) ||
	/cannot lock ref '.*': is at [0-9a-f]+ but expected [0-9a-f]+/.test(stderr);

/** True when git could not reach the remote because port 22 is blocked. */
export const isSshBlockedError = (stderr: string): boolean =>
	/port 22|ssh: connect to host|kex_exchange_identification/.test(stderr);

/** True when a fresh Mac refuses to run git until the Xcode licence is accepted. */
export const isXcodeLicenseError = (stderr: string): boolean =>
	/agreeing to the Xcode(\/iOS)? license|You have not agreed to the Xcode license|requires the Xcode license|xcodebuild: error:.*license/i.test(
		stderr,
	);

export interface XcodeLicenseToast {
	message: string;
	actionLabel: string;
	durationMs: number;
}

/** The toast GIT-16 shows, with the one action that accepts the licence for the user. */
export const xcodeLicenseToast = (): XcodeLicenseToast => ({
	message: XCODE_LICENSE_TOAST_MESSAGE,
	actionLabel: XCODE_LICENSE_FIX_ACTION,
	durationMs: XCODE_LICENSE_TOAST_MS,
});

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

/** A started git command, for work the user may cancel. */
export interface RunningGitCommand {
	readonly id: string;
	readonly done: Promise<Result<ShellOutput>>;
	cancel(): Promise<void>;
}

export interface GitRunner {
	/** Runs the command. `Ok` means the process ran, with any exit code. Takes no lock. */
	run(command: GitCommand, options: GitRunOptions): Promise<Result<ShellOutput>>;
	/**
	 * Like `run`, but an exit code outside `command.okExitCodes` (default `[0]`) becomes an `Err`
	 * with code `git_failed` and the trimmed stderr as the message.
	 */
	runChecked(command: GitCommand, options: GitRunOptions): Promise<Result<ShellOutput>>;
	/** Output of `runChecked` with whitespace removed from both ends. */
	stdout(command: GitCommand, options: GitRunOptions): Promise<Result<string>>;
	/** Starts the command and returns a handle. Work that waits for the user cancels through it. */
	start(command: GitCommand, options: GitRunOptions): Promise<RunningGitCommand>;
	/** Holds the worktree lock. Most write actions need only this. */
	withWorktreeLock<T>(worktreePath: string, work: () => Promise<T>): Promise<T>;
	/** Holds the worktree lock, then the repo lock inside it, in that order. */
	withWorktreeAndRepoLocks<T>(
		worktreePath: string,
		repoRootPath: string,
		work: () => Promise<T>,
	): Promise<T>;
}

export interface ShellGitRunnerDeps {
	shell: Shell;
	locks: KeyedMutex;
	/** Waits `ms`. A parameter so tests do not sleep. */
	sleep: (ms: number) => Promise<void>;
	log: (level: "warn" | "info", message: string) => void;
}

/** True when an exit code is one the command declared as success. */
export const isSuccessfulExit = (command: GitCommand, exitCode: number): boolean =>
	(command.okExitCodes ?? [0]).includes(exitCode);

/** Keeps timeouts, cancels and output limits as they are; a program that could not start becomes `process_spawn`. */
export const gitShellError = (error: AppError): AppError =>
	error.code === SHELL_TIMEOUT_CODE ||
	error.code === "shell_cancelled" ||
	error.code === "shell_output_too_large" ||
	error.code === PROCESS_SPAWN_CODE
		? error
		: appError(PROCESS_SPAWN_CODE, error.message, error);

export class ShellGitRunner implements GitRunner {
	readonly #deps: ShellGitRunnerDeps;
	#loginPath: Promise<string | null> | undefined;

	constructor(deps: ShellGitRunnerDeps) {
		this.#deps = deps;
	}

	async run(command: GitCommand, options: GitRunOptions): Promise<Result<ShellOutput>> {
		const first = await this.#runWithLockRetry(command, options);
		if (!this.#shouldTryHttps(command, first)) return first;
		const retry = await this.#runWithLockRetry(command, {
			...options,
			env: { ...(options.env ?? {}), ...httpsFallbackEnv() },
		});
		if (retry.ok && isSuccessfulExit(command, retry.value.exitCode)) {
			this.#deps.log("info", "HTTPS retry succeeded");
			return retry;
		}
		this.#deps.log("warn", "SSH to the remote is blocked; HTTPS retry also failed");
		return first;
	}

	async runChecked(command: GitCommand, options: GitRunOptions): Promise<Result<ShellOutput>> {
		const result = await this.run(command, options);
		if (!result.ok) return result;
		if (isSuccessfulExit(command, result.value.exitCode)) return result;
		return err(failedCommandError(command, result.value));
	}

	async stdout(command: GitCommand, options: GitRunOptions): Promise<Result<string>> {
		const result = await this.runChecked(command, options);
		return result.ok ? ok(result.value.stdout.trim()) : result;
	}

	async start(command: GitCommand, options: GitRunOptions): Promise<RunningGitCommand> {
		const running: RunningCommand = this.#deps.shell.start(
			await this.#toShellCommand(command, options),
		);
		return {
			id: running.id,
			done: running.done.then(
				(result): Result<ShellOutput> => (result.ok ? result : err(gitShellError(result.error))),
			),
			cancel: () => running.cancel(),
		};
	}

	withWorktreeLock<T>(worktreePath: string, work: () => Promise<T>): Promise<T> {
		return this.#withLock(worktreeLockKey(worktreePath), work);
	}

	withWorktreeAndRepoLocks<T>(
		worktreePath: string,
		repoRootPath: string,
		work: () => Promise<T>,
	): Promise<T> {
		return this.withWorktreeLock(worktreePath, () =>
			this.#withLock(repoLockKey(repoRootPath), work),
		);
	}

	#shouldTryHttps(command: GitCommand, result: Result<ShellOutput>): boolean {
		return (
			command.network === true &&
			command.program === "git" &&
			result.ok &&
			!isSuccessfulExit(command, result.value.exitCode) &&
			isSshBlockedError(result.value.stderr)
		);
	}

	async #runWithLockRetry(
		command: GitCommand,
		options: GitRunOptions,
	): Promise<Result<ShellOutput>> {
		const shellCommand = await this.#toShellCommand(command, options);
		const retryOnLock = command.retryOnLock ?? command.program === "git";
		const delays = retryOnLock ? GIT_LOCK_RETRY_DELAYS_MS : [];
		let result = await this.#runShell(shellCommand);
		for (const delay of delays) {
			if (!result.ok || !isGitLockError(result.value.stderr)) break;
			await this.#deps.sleep(delay);
			result = await this.#runShell(shellCommand);
		}
		return result;
	}

	async #runShell(shellCommand: ShellCommand): Promise<Result<ShellOutput>> {
		const result = await this.#deps.shell.run(shellCommand);
		return result.ok ? result : err(gitShellError(result.error));
	}

	async #toShellCommand(command: GitCommand, options: GitRunOptions): Promise<ShellCommand> {
		const args =
			command.program === "git" ? [...QUOTE_PATH_OFF_ARGS, ...command.args] : [...command.args];
		const env = await this.#shellEnv(options.env);
		return {
			program: command.program,
			args,
			cwd: options.cwd,
			...(env === undefined ? {} : { env }),
			...(command.stdin === undefined ? {} : { stdin: command.stdin }),
			...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs }),
		};
	}

	/** Puts the captured login-shell PATH in front of every command (services-map 5A.8.3). */
	async #shellEnv(
		extra: Readonly<Record<string, string>> | undefined,
	): Promise<Readonly<Record<string, string>> | undefined> {
		const loginPath = await this.#loginShellPath();
		if (loginPath === null && extra === undefined) return undefined;
		const env: Record<string, string> = { ...(extra ?? {}) };
		if (loginPath !== null) {
			env.PATH =
				env.PATH === undefined || env.PATH.length === 0 ? loginPath : `${loginPath}:${env.PATH}`;
		}
		return Object.keys(env).length === 0 ? undefined : env;
	}

	/** Reads the login-shell PATH once. A failed read is logged and not kept, so the next command tries again. */
	#loginShellPath(): Promise<string | null> {
		this.#loginPath ??= this.#deps.shell.loginEnv().then(
			(env) => env.path,
			(cause: unknown) => {
				this.#loginPath = undefined;
				const message = messageOf(cause);
				this.#deps.log("warn", `Could not read the login-shell PATH: ${message}`);
				return null;
			},
		);
		return this.#loginPath;
	}

	/**
	 * Runs `work` under `key`. If the key is already held, a warning is logged when the wait beats
	 * the warm timeout. The wait is never aborted.
	 */
	async #withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
		let acquired = false;
		if (this.#deps.locks.isHeld(key)) {
			void this.#deps.sleep(LOCK_WARM_TIMEOUT_MS).then(
				() => {
					if (!acquired) this.#deps.log("warn", LOCK_WARM_TIMEOUT_MESSAGE);
				},
				(cause: unknown) => {
					const message = messageOf(cause);
					this.#deps.log("warn", `Could not time a lock wait: ${message}`);
				},
			);
		}
		return this.#deps.locks.run(key, async () => {
			acquired = true;
			return work();
		});
	}
}

/** Builds the error for a command that exited with a code it did not list as success. */
export const failedCommandError = (command: GitCommand, output: ShellOutput) => {
	if (isXcodeLicenseError(output.stderr)) {
		return appError("git_xcode_license", XCODE_LICENSE_TOAST_MESSAGE);
	}
	if (command.network === true && isSshBlockedError(output.stderr)) {
		return appError("git_ssh_blocked", SSH_BLOCKED_HTTPS_FAILED_MESSAGE);
	}
	return appError(
		"git_failed",
		output.stderr.trim() ||
			`${command.program} ${command.args[0] ?? ""} exited with code ${output.exitCode}`,
	);
};
