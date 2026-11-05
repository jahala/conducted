/**
 * @feature test support One fake GitRunner for service tests
 * Owns: `FakeGitRunner`, a `GitRunner` whose process answers come from a handler the test writes,
 * and `gitOutput`, the one way to build such an answer. Everything else is the real runner's own
 * logic: `runChecked` turns an exit code outside `okExitCodes` into the same `git_failed` error
 * (`failedCommandError`), `stdout` trims, and the worktree and repo locks are real keyed mutexes
 * taken in the real order.
 * Behaviour: core/git/runner.ts is the real runner; fake-git-runner.test.ts runs the same answers
 * through `ShellGitRunner` over a real temp repository and checks that they match.
 * Contract test: fake-git-runner.test.ts
 * Must handle: a command the handler does not know is an `Err` with code `git_unscripted` and the
 * command in the message, never an `Ok`; every call is recorded in order with its options; a lock
 * held by one call makes the next call on the same key wait, as in the app; `start` throws unless
 * the test passes one, because most tests never start a cancellable command.
 * Our design choice: a handler sees the `GitCommand` the service built, before the runner adds
 * `-c core.quotePath=false` or the login PATH, so a test matches on `args`.
 * Test first: a fake answer for merge-base, show-ref, rev-parse @{u}, push -u and restore
 * --staged gives the same exit code and output as git in a temp repository.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { GitCommand } from "../core/git/commands.ts";
import { KeyedMutex, repoLockKey, worktreeLockKey } from "../core/git/locks.ts";
import {
	failedCommandError,
	type GitRunner,
	type GitRunOptions,
	isSuccessfulExit,
	type RunningGitCommand,
} from "../core/git/runner.ts";
import type { ShellOutput } from "../platform/platform.ts";

/** One answer of a process that ran: `Ok` with any exit code, or `Err` for one that could not start. */
export type GitAnswer = Result<ShellOutput>;

export type GitHandler = (
	command: GitCommand,
	options: GitRunOptions,
) => GitAnswer | Promise<GitAnswer>;

export interface FakeGitCall {
	readonly command: GitCommand;
	readonly options: GitRunOptions;
}

export interface FakeGitRunnerOptions {
	/** Share one mutex between runners, or read its state. Defaults to a new one. */
	locks?: KeyedMutex;
	/** Starts a cancellable command. Without it `start` throws. */
	start?: (command: GitCommand, options: GitRunOptions) => Promise<RunningGitCommand>;
}

/** A process that ran and exited with `exitCode`. */
export const gitOutput = (stdout = "", stderr = "", exitCode = 0): GitAnswer =>
	ok({ stdout, stderr, exitCode });

/** The answer for a command nobody scripted. */
export const gitUnscripted = (command: GitCommand): GitAnswer =>
	err(appError("git_unscripted", `No answer was scripted for: ${commandText(command)}`));

export const commandText = (command: GitCommand): string =>
	[command.program, ...command.args].join(" ");

export class FakeGitRunner implements GitRunner {
	readonly calls: FakeGitCall[] = [];
	/** The commands run so far, in order. The same array for the life of the runner. */
	readonly commands: GitCommand[] = [];
	/** Worktree paths locked so far, in order. */
	readonly worktreeLocks: string[] = [];
	/** Repo root paths locked so far, in order. */
	readonly repoLocks: string[] = [];
	readonly locks: KeyedMutex;
	readonly #handler: GitHandler;
	readonly #start: FakeGitRunnerOptions["start"];

	constructor(handler: GitHandler, options: FakeGitRunnerOptions = {}) {
		this.#handler = handler;
		this.locks = options.locks ?? new KeyedMutex();
		this.#start = options.start;
	}

	async run(command: GitCommand, options: GitRunOptions): Promise<Result<ShellOutput>> {
		this.calls.push({ command, options });
		this.commands.push(command);
		return this.#handler(command, options);
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
		if (this.#start === undefined) {
			throw new Error(`start was not scripted for: ${commandText(command)}`);
		}
		this.calls.push({ command, options });
		this.commands.push(command);
		return this.#start(command, options);
	}

	withWorktreeLock<T>(worktreePath: string, work: () => Promise<T>): Promise<T> {
		this.worktreeLocks.push(worktreePath);
		return this.locks.run(worktreeLockKey(worktreePath), work);
	}

	withWorktreeAndRepoLocks<T>(
		worktreePath: string,
		repoRootPath: string,
		work: () => Promise<T>,
	): Promise<T> {
		return this.withWorktreeLock(worktreePath, () => {
			this.repoLocks.push(repoRootPath);
			return this.locks.run(repoLockKey(repoRootPath), work);
		});
	}
}
