import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { RunningCommand, Shell, ShellCommand, ShellOutput } from "../../platform/platform.ts";
import { fetch } from "./commands.ts";
import { KeyedMutex, repoLockKey } from "./locks.ts";
import {
	failedCommandError,
	GIT_LOCK_RETRY_DELAYS_MS,
	httpsFallbackEnv,
	isGitLockError,
	isSshBlockedError,
	isXcodeLicenseError,
	LOCK_WARM_TIMEOUT_MESSAGE,
	LOCK_WARM_TIMEOUT_MS,
	PROCESS_SPAWN_CODE,
	QUOTE_PATH_OFF_ARGS,
	SHELL_TIMEOUT_CODE,
	ShellGitRunner,
	SSH_BLOCKED_HTTPS_FAILED_MESSAGE,
	XCODE_LICENSE_FIX_ACTION,
	XCODE_LICENSE_TOAST_MESSAGE,
	XCODE_LICENSE_TOAST_MS,
	xcodeLicenseToast,
} from "./runner.ts";

const out = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};

const flush = async (): Promise<void> => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

interface FakeShell {
	shell: Shell;
	calls: ShellCommand[];
}

const makeShell = (
	runHandler: (command: ShellCommand) => Promise<Result<ShellOutput>> = async () => ok(out(0)),
	startHandler?: (command: ShellCommand) => RunningCommand,
	loginPath = "/Users/me/.local/bin:/usr/bin:/bin",
	loginEnv: Shell["loginEnv"] = async () => ({ shell: "/bin/zsh", path: loginPath }),
): FakeShell => {
	const calls: ShellCommand[] = [];
	return {
		calls,
		shell: {
			run: (command) => {
				calls.push(command);
				return runHandler(command);
			},
			start: (command) => {
				calls.push(command);
				return (
					startHandler?.(command) ?? {
						id: "started",
						done: Promise.resolve(ok(out(0))),
						cancel: async () => undefined,
					}
				);
			},
			loginEnv,
		},
	};
};

const makeRunner = (shell: Shell) => {
	const logs: { level: "warn" | "info"; message: string }[] = [];
	const sleeps: number[] = [];
	const warmWaits: (() => void)[] = [];
	const locks = new KeyedMutex();
	const runner = new ShellGitRunner({
		shell,
		locks,
		sleep: (ms) => {
			if (ms === LOCK_WARM_TIMEOUT_MS) {
				return new Promise<void>((resolve) => {
					warmWaits.push(resolve);
				});
			}
			sleeps.push(ms);
			return Promise.resolve();
		},
		log: (level, message) => {
			logs.push({ level, message });
		},
	});
	return { runner, logs, sleeps, locks, warmWaits };
};

describe("GIT-01 isGitLockError", () => {
	it("recognises an index lock", () => {
		expect(isGitLockError("fatal: Unable to create '/r/.git/index.lock': File exists.")).toBe(true);
	});
	it("recognises a ref lock race", () => {
		expect(
			isGitLockError(
				"error: cannot lock ref 'refs/remotes/origin/x': is at abc123 but expected def456",
			),
		).toBe(true);
	});
	it("ignores other errors", () => {
		expect(isGitLockError("fatal: not a git repository")).toBe(false);
	});
});

describe("GIT-01 isSshBlockedError", () => {
	it("matches the three blocked-SSH messages", () => {
		expect(isSshBlockedError("ssh: connect to host github.com port 22: Operation timed out")).toBe(
			true,
		);
		expect(isSshBlockedError("kex_exchange_identification: Connection closed")).toBe(true);
		expect(isSshBlockedError("Permission denied (publickey).")).toBe(false);
	});
});

describe("GIT-01 httpsFallbackEnv", () => {
	it("declares as many config pairs as it counts", () => {
		const env = httpsFallbackEnv();
		const count = Number(env.GIT_CONFIG_COUNT);
		for (let i = 0; i < count; i++) {
			expect(env[`GIT_CONFIG_KEY_${i}`]).toBeDefined();
			expect(env[`GIT_CONFIG_VALUE_${i}`]).toBeDefined();
		}
	});
});

describe("GIT-01 failedCommandError", () => {
	it("uses stderr when there is some", () => {
		const error = failedCommandError(
			{ program: "git", args: ["push"] },
			{ exitCode: 1, stdout: "", stderr: " rejected \n" },
		);
		expect(error).toEqual({ code: "git_failed", message: "rejected" });
	});

	it("explains a blocked SSH network when HTTPS failed too", () => {
		const error = failedCommandError(
			{ program: "git", args: ["push"], network: true },
			{
				exitCode: 1,
				stdout: "",
				stderr: "ssh: connect to host github.com port 22: Operation timed out",
			},
		);
		expect(error).toEqual({
			code: "git_ssh_blocked",
			message: SSH_BLOCKED_HTTPS_FAILED_MESSAGE,
		});
		expect(error.message).toContain("this network appears to block SSH, and HTTPS failed too");
	});

	it("names an unaccepted Xcode licence", () => {
		const error = failedCommandError(
			{ program: "git", args: ["status"] },
			{
				exitCode: 128,
				stdout: "",
				stderr: "You have not agreed to the Xcode license agreements.",
			},
		);
		expect(error).toEqual({
			code: "git_xcode_license",
			message: XCODE_LICENSE_TOAST_MESSAGE,
		});
	});
});

describe("GIT-01 ShellGitRunner", () => {
	it("runs git with core.quotePath turned off and leaves other programs alone", async () => {
		const shell = makeShell(async () => ok(out(0)));
		const { runner } = makeRunner(shell.shell);

		await runner.run({ program: "git", args: ["status"] }, { cwd: "/w" });
		await runner.run({ program: "gh", args: ["pr", "list"] }, { cwd: "/w" });
		await runner.run({ program: "/b/checkpointer.sh", args: ["save"] }, { cwd: "/w" });

		expect(shell.calls[0]?.args).toEqual([...QUOTE_PATH_OFF_ARGS, "status"]);
		expect(shell.calls[1]?.args).toEqual(["pr", "list"]);
		expect(shell.calls[2]).toMatchObject({
			program: "/b/checkpointer.sh",
			args: ["save"],
		});
	});

	it("logs a login-shell PATH that cannot be read and tries again on the next command", async () => {
		let attempts = 0;
		const shell = makeShell(
			async () => ok(out(0)),
			undefined,
			"/Users/me/bin",
			async () => {
				attempts += 1;
				if (attempts === 1) throw new Error("login shell timed out");
				return { shell: "/bin/zsh", path: "/Users/me/bin" };
			},
		);
		const { runner, logs } = makeRunner(shell.shell);
		await runner.run(fetch("origin"), { cwd: "/w" });
		await runner.run(fetch("origin"), { cwd: "/w" });
		expect(logs).toContainEqual({
			level: "warn",
			message: "Could not read the login-shell PATH: login shell timed out",
		});
		expect(shell.calls[0]?.env).toBeUndefined();
		expect(shell.calls[1]?.env?.PATH).toBe("/Users/me/bin");
		expect(attempts).toBe(2);
	});

	it("puts the captured login-shell PATH in front of every call", async () => {
		const shell = makeShell(async () => ok(out(0)));
		const { runner } = makeRunner(shell.shell);

		await runner.run({ program: "git", args: ["status"] }, { cwd: "/w", env: { FOO: "bar" } });

		expect(shell.calls[0]?.env).toEqual({
			FOO: "bar",
			PATH: "/Users/me/.local/bin:/usr/bin:/bin",
		});
	});

	it("retries an index.lock failure after 50, 100 and 200 ms", async () => {
		let calls = 0;
		const shell = makeShell(async () => {
			calls += 1;
			return calls < 4
				? ok(out(1, "", "fatal: Unable to create '/r/.git/index.lock': File exists."))
				: ok(out(0, "done"));
		});
		const { runner, sleeps } = makeRunner(shell.shell);

		const result = await runner.run({ program: "git", args: ["add", "."] }, { cwd: "/w" });

		expect(result.ok && result.value.stdout).toBe("done");
		expect(sleeps).toEqual([...GIT_LOCK_RETRY_DELAYS_MS]);
		expect(calls).toBe(4);
	});

	it("retries a cannot-lock-ref race too", async () => {
		let calls = 0;
		const shell = makeShell(async () => {
			calls += 1;
			return calls === 1
				? ok(
						out(
							1,
							"",
							"error: cannot lock ref 'refs/remotes/origin/x': is at abc123 but expected def456",
						),
					)
				: ok(out(0, "done"));
		});
		const { runner, sleeps } = makeRunner(shell.shell);

		await runner.run({ program: "git", args: ["fetch"] }, { cwd: "/w" });

		expect(sleeps).toEqual([GIT_LOCK_RETRY_DELAYS_MS[0]]);
		expect(calls).toBe(2);
	});

	it("does not retry a command that opted out of lock retries", async () => {
		const shell = makeShell(async () =>
			ok(out(1, "", "fatal: Unable to create '/r/.git/index.lock': File exists.")),
		);
		const { runner, sleeps } = makeRunner(shell.shell);

		await runner.run(
			{ program: "git", args: ["checkout", "x"], retryOnLock: false },
			{ cwd: "/w" },
		);

		expect(sleeps).toEqual([]);
		expect(shell.calls).toHaveLength(1);
	});

	it("leaves an internal script's arguments alone and does not retry its lock error", async () => {
		const shell = makeShell(async () =>
			ok(out(1, "", "fatal: Unable to create '/r/.git/index.lock': File exists.")),
		);
		const { runner, sleeps } = makeRunner(shell.shell);

		await runner.run({ program: "/b/checkpointer.sh", args: ["save", "--id", "x"] }, { cwd: "/w" });

		expect(shell.calls[0]).toMatchObject({
			program: "/b/checkpointer.sh",
			args: ["save", "--id", "x"],
		});
		expect(sleeps).toEqual([]);
		expect(shell.calls).toHaveLength(1);
	});

	it("retries a blocked network git command once over HTTPS", async () => {
		let calls = 0;
		const shell = makeShell(async () => {
			calls += 1;
			return calls === 1
				? ok(out(1, "", "ssh: connect to host github.com port 22: Operation timed out"))
				: ok(out(0, "pushed"));
		});
		const { runner, logs } = makeRunner(shell.shell);

		const result = await runner.run(
			{ program: "git", args: ["push"], network: true },
			{ cwd: "/w" },
		);

		expect(result.ok && result.value.exitCode).toBe(0);
		expect(calls).toBe(2);
		expect(shell.calls[0]?.env?.GIT_TERMINAL_PROMPT).toBeUndefined();
		expect(shell.calls[1]?.env).toMatchObject(httpsFallbackEnv());
		expect(shell.calls[0]?.env).not.toHaveProperty("GH_TOKEN");
		expect(shell.calls[1]?.env).not.toHaveProperty("GH_TOKEN");
		expect(logs).toContainEqual({ level: "info", message: "HTTPS retry succeeded" });
	});

	it("keeps the original SSH failure when the HTTPS retry fails", async () => {
		let calls = 0;
		const shell = makeShell(async () => {
			calls += 1;
			return calls === 1
				? ok(out(1, "", "ssh: connect to host github.com port 22: Operation timed out"))
				: ok(out(1, "", "fatal: could not read Username"));
		});
		const { runner, logs } = makeRunner(shell.shell);

		const result = await runner.run(
			{ program: "git", args: ["push"], network: true },
			{ cwd: "/w" },
		);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.stderr).toContain("port 22");
		expect(calls).toBe(2);
		expect(logs).toContainEqual({
			level: "warn",
			message: "SSH to the remote is blocked; HTTPS retry also failed",
		});
	});

	it("returns stdout on success and the stderr text on failure", async () => {
		const shell = makeShell(async () => ok(out(0, "  abc123 \n")));
		const { runner } = makeRunner(shell.shell);

		await expect(
			runner.stdout({ program: "git", args: ["rev-parse", "HEAD"] }, { cwd: "/w" }),
		).resolves.toEqual(ok("abc123"));

		const failing = makeShell(async () => ok(out(1, "", " fatal: bad revision \n")));
		const failingRunner = makeRunner(failing.shell).runner;
		await expect(
			failingRunner.stdout({ program: "git", args: ["rev-parse", "nope"] }, { cwd: "/w" }),
		).resolves.toEqual(err(appError("git_failed", "fatal: bad revision")));
	});

	it("returns Err when a program cannot start and keeps a timeout as it is", async () => {
		const spawn = makeShell(async () => err(appError("shell_spawn_failed", "spawn git ENOENT")));
		const spawnResult = await makeRunner(spawn.shell).runner.run(
			{ program: "git", args: ["status"] },
			{ cwd: "/w" },
		);
		expect(spawnResult.ok).toBe(false);
		if (!spawnResult.ok) expect(spawnResult.error.code).toBe(PROCESS_SPAWN_CODE);

		const timeout = makeShell(async () => err(appError(SHELL_TIMEOUT_CODE, "timed out")));
		const timeoutResult = await makeRunner(timeout.shell).runner.run(
			{ program: "git", args: ["status"], timeoutMs: 10 },
			{ cwd: "/w" },
		);
		expect(timeoutResult.ok).toBe(false);
		if (!timeoutResult.ok) expect(timeoutResult.error.code).toBe(SHELL_TIMEOUT_CODE);
	});

	it("starts a command through the shell and exposes cancel", async () => {
		const cancel = vi.fn(async () => undefined);
		const shell = makeShell(
			async () => ok(out(0)),
			() => ({ id: "git-1", done: Promise.resolve(ok(out(143))), cancel }),
		);
		const { runner } = makeRunner(shell.shell);

		const running = await runner.start({ program: "git", args: ["status"] }, { cwd: "/w" });

		expect(running.id).toBe("git-1");
		expect(shell.calls[0]?.args).toEqual([...QUOTE_PATH_OFF_ARGS, "status"]);
		expect(shell.calls[0]?.env?.PATH).toContain("/Users/me/.local/bin");
		await running.cancel();
		expect(cancel).toHaveBeenCalledTimes(1);
		await expect(running.done).resolves.toEqual(ok(out(143)));
	});

	it("turns a start failure into process_spawn and keeps a start timeout", async () => {
		const spawn = makeShell(
			async () => ok(out(0)),
			() => ({
				id: "git-spawn",
				done: Promise.resolve(err(appError("shell_spawn_failed", "spawn git ENOENT"))),
				cancel: async () => undefined,
			}),
		);
		const spawnRunning = await makeRunner(spawn.shell).runner.start(
			{ program: "gh", args: ["pr", "list"] },
			{ cwd: "/w" },
		);
		await expect(spawnRunning.done).resolves.toMatchObject({
			ok: false,
			error: { code: PROCESS_SPAWN_CODE, message: "spawn git ENOENT" },
		});

		const timeout = makeShell(
			async () => ok(out(0)),
			() => ({
				id: "git-timeout",
				done: Promise.resolve(err(appError(SHELL_TIMEOUT_CODE, "timed out"))),
				cancel: async () => undefined,
			}),
		);
		const timedRunning = await makeRunner(timeout.shell).runner.start(
			{ program: "git", args: ["status"], timeoutMs: 10 },
			{ cwd: "/w" },
		);
		await expect(timedRunning.done).resolves.toMatchObject({
			ok: false,
			error: { code: SHELL_TIMEOUT_CODE, message: "timed out" },
		});
	});

	it("runs a fetch without taking the repo lock", async () => {
		const shellGate = deferred();
		const repoGate = deferred();
		let started = false;
		const shell = makeShell(async () => {
			started = true;
			await shellGate.promise;
			return ok(out(0));
		});
		const { runner, locks } = makeRunner(shell.shell);

		const hold = locks.run(repoLockKey("/r"), () => repoGate.promise);
		const fetchRun = runner.run(fetch("origin", ["main"]), { cwd: "/w" });
		await flush();
		expect(started).toBe(true);

		shellGate.resolve();
		await fetchRun;
		repoGate.resolve();
		await hold;
	});

	it("takes the repo lock inside the worktree lock", async () => {
		const shell = makeShell(async () => ok(out(0)));
		const { runner, locks } = makeRunner(shell.shell);
		let repoRan = false;
		let inner: Promise<void> | undefined;

		await runner.withWorktreeAndRepoLocks("/w", "/r", async () => {
			expect(locks.size).toBe(2);
			inner = locks.run(repoLockKey("/r"), async () => {
				repoRan = true;
			});
			await flush();
			expect(repoRan).toBe(false);
		});

		await inner;
		expect(repoRan).toBe(true);
	});

	it("starts no warm-up timer for a lock that is free", async () => {
		const shell = makeShell(async () => ok(out(0)));
		const { runner, warmWaits } = makeRunner(shell.shell);
		await runner.withWorktreeLock("/w", async () => undefined);
		await runner.withWorktreeAndRepoLocks("/w", "/r", async () => undefined);
		expect(warmWaits).toHaveLength(0);
	});

	it("logs a warning when a lock is waited on for 10 seconds and still runs the action", async () => {
		const shell = makeShell(async () => ok(out(0)));
		const { runner, logs, warmWaits } = makeRunner(shell.shell);
		const gate = deferred();
		const first = runner.withWorktreeLock("/w", () => gate.promise);
		let ran = false;
		const second = runner.withWorktreeLock("/w", async () => {
			ran = true;
		});

		await flush();
		expect(warmWaits).toHaveLength(1);
		for (const resolve of warmWaits) resolve();
		await flush();

		expect(logs).toContainEqual({ level: "warn", message: LOCK_WARM_TIMEOUT_MESSAGE });
		expect(ran).toBe(false);

		gate.resolve();
		await first;
		await second;
		expect(ran).toBe(true);
	});
});

describe("GIT-01 Xcode licence message", () => {
	it("recognises the licence errors a fresh Mac prints", () => {
		expect(isXcodeLicenseError("You have not agreed to the Xcode license agreements.")).toBe(true);
		expect(
			isXcodeLicenseError(
				'Agreeing to the Xcode/iOS license requires admin privileges, please run "sudo xcodebuild -license" and then retry this command.',
			),
		).toBe(true);
		expect(isXcodeLicenseError("fatal: not a git repository")).toBe(false);
	});

	it("offers the toast for 15 seconds with a Run for me action", () => {
		expect(xcodeLicenseToast()).toEqual({
			message: "Xcode license is not accepted",
			actionLabel: XCODE_LICENSE_FIX_ACTION,
			durationMs: XCODE_LICENSE_TOAST_MS,
		});
		expect(XCODE_LICENSE_TOAST_MS).toBe(15_000);
	});
});
