import { describe, expect, test } from "bun:test";
import type { AppError, Result } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import {
	type CaptureCommand,
	captureCommandFor,
	classifyShellEnvFailure,
	FALLBACK_CAPTURE_TIMEOUT_MS,
	fallbackCaptureCommand,
	LoginShellEnvProvider,
	PRIMARY_CAPTURE_TIMEOUT_MS,
	type ShellEnvFailure,
	type ShellEnvFailureKind,
	type SpawnText,
} from "./capture.ts";

const logger = createLogger({
	sink: () => {},
	clock: { now: () => 0 },
	level: "error",
	scope: "test",
});

function dump(marker: string, vars: Record<string, string>): string {
	const body = Object.entries(vars)
		.map(([name, value]) => `${name}=${value}`)
		.join("\0");
	return `shell start-up banner\n${marker}${body}\0${marker}trailing prompt`;
}

interface SpawnCall {
	command: CaptureCommand;
	timeoutMs: number;
}

function recordingSpawn(answer: (call: SpawnCall) => Result<string>): {
	spawnText: SpawnText;
	calls: SpawnCall[];
} {
	const calls: SpawnCall[] = [];
	return {
		calls,
		spawnText: (command, options) => {
			const call = { command, timeoutMs: options.timeoutMs };
			calls.push(call);
			return Promise.resolve(answer(call));
		},
	};
}

function markers(...values: string[]): () => string {
	let next = 0;
	return () => values[next++] ?? `__marker_${next}__`;
}

function provider(shellPath: string, spawnText: SpawnText, newMarker = markers("M1", "M2")) {
	return new LoginShellEnvProvider({ spawnText, shellPath, newMarker, logger });
}

describe("SIDE-10 capture command", () => {
	test("zsh and bash use -ilc and print env -0 between the marker", () => {
		for (const shell of ["/bin/zsh", "/bin/bash"]) {
			const cmd = captureCommandFor(shell, "MK");
			expect(cmd.command).toBe(shell);
			expect(cmd.args[0]).toBe("-ilc");
			expect(cmd.args[1]).toBe("printf '%s' 'MK'; env -0; printf '%s' 'MK'");
		}
	});

	test("fish uses its own flag spelling", () => {
		const cmd = captureCommandFor("/opt/homebrew/bin/fish", "MK");
		expect(cmd.command).toBe("/opt/homebrew/bin/fish");
		expect(cmd.args.slice(0, 3)).toEqual(["-i", "-l", "-c"]);
		expect(cmd.args[3]).toBe("printf '%s' 'MK'; env -0; printf '%s' 'MK'");
	});

	test("an unknown shell falls back to a login zsh", () => {
		expect(captureCommandFor("/bin/tcsh", "MK")).toEqual(fallbackCaptureCommand("MK"));
	});

	test("the fallback is a login zsh without the interactive flag", () => {
		const cmd = fallbackCaptureCommand("MK");
		expect(cmd.command).toBe("/bin/zsh");
		expect(cmd.args[0]).toBe("-lc");
		expect(cmd.args[1]).toBe("printf '%s' 'MK'; env -0; printf '%s' 'MK'");
	});
});

describe("SIDE-10 login-shell capture", () => {
	test("parses the dump, strips secrets and keeps the login-shell PATH", async () => {
		const marker = "M1";
		const { spawnText, calls } = recordingSpawn(() =>
			ok(
				dump(marker, {
					PATH: "/opt/homebrew/bin:/usr/bin:/bin",
					ANTHROPIC_API_KEY: "secret",
					BASH_FUNC_jump: "() { :; }",
					SHELL: "/bin/zsh",
				}),
			),
		);

		const result = await provider("/bin/zsh", spawnText).get();

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.shell).toBe("/bin/zsh");
		expect(result.value.path).toBe("/opt/homebrew/bin:/usr/bin:/bin");
		expect(result.value.env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(result.value.env.BASH_FUNC_jump).toBeUndefined();
		expect(result.value.env.SHELL).toBe("/bin/zsh");
		expect(calls[0]?.command.args[1]).toContain(`'${marker}'`);
	});

	test("gives the primary 5 seconds and the fallback 3 seconds with a fresh marker", async () => {
		const { spawnText, calls } = recordingSpawn((call) =>
			call.timeoutMs === PRIMARY_CAPTURE_TIMEOUT_MS
				? err({ code: "shell_capture_failed", message: "the prompt hung" })
				: ok(dump("M2", { PATH: "/bin" })),
		);

		const result = await provider("/bin/zsh", spawnText).get();

		expect(result.ok).toBe(true);
		expect(calls.map((call) => call.timeoutMs)).toEqual([
			PRIMARY_CAPTURE_TIMEOUT_MS,
			FALLBACK_CAPTURE_TIMEOUT_MS,
		]);
		expect(calls[0]?.command.args[1]).toContain("'M1'");
		expect(calls[1]?.command.command).toBe("/bin/zsh");
		expect(calls[1]?.command.args[0]).toBe("-lc");
		expect(calls[1]?.command.args[1]).toContain("'M2'");
		if (result.ok) expect(result.value.shell).toBe("/bin/zsh");
	});

	test("an unknown shell skips straight to the 3 second fallback", async () => {
		const { spawnText, calls } = recordingSpawn(() => ok(dump("M1", { PATH: "/bin" })));

		const result = await provider("/bin/tcsh", spawnText).get("/work/lisbon");

		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.timeoutMs).toBe(FALLBACK_CAPTURE_TIMEOUT_MS);
		expect(calls[0]?.command).toEqual(fallbackCaptureCommand("M1", "/work/lisbon"));
	});

	test("a failure is not cached, so the next call tries again", async () => {
		let attempt = 0;
		const { spawnText, calls } = recordingSpawn(() => {
			attempt += 1;
			return attempt === 1
				? err({ code: "shell_capture_failed", message: "no shell" })
				: ok(dump("M1", { PATH: "/bin" }));
		});
		const subject = provider("/bin/tcsh", spawnText, () => "M1");

		const failed = await subject.get();
		const retried = await subject.get();

		expect(failed.ok).toBe(false);
		expect(retried.ok).toBe(true);
		expect(calls).toHaveLength(2);
	});

	test("a successful capture is cached until refresh", async () => {
		const { spawnText, calls } = recordingSpawn(() => ok(dump("M1", { PATH: "/bin" })));
		const subject = provider("/bin/zsh", spawnText, () => "M1");

		const first = await subject.get();
		expect(first.ok).toBe(true);
		await subject.get();
		await subject.get();
		expect(calls).toHaveLength(1);

		await subject.refresh();
		expect(calls).toHaveLength(2);
	});

	test("a dump without its closing marker is an error", async () => {
		const { spawnText } = recordingSpawn(() => ok("M1PATH=/bin"));

		const result = await provider("/bin/tcsh", spawnText).get();

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("env_dump_cut");
	});

	test("two callers at once share one capture", async () => {
		let release: (result: Result<string>) => void = () => {};
		const waiting = new Promise<Result<string>>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const spawnText: SpawnText = () => {
			calls += 1;
			return waiting;
		};
		const subject = provider("/bin/zsh", spawnText);

		const first = subject.get();
		const second = subject.get();
		expect(calls).toBe(1);

		release(ok(dump("M1", { PATH: "/bin" })));
		const [a, b] = await Promise.all([first, second]);
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		expect(calls).toBe(1);
	});

	test("runs the login shell in the folder it was asked about", () => {
		const cmd = captureCommandFor("/bin/zsh", "MK", "/work/lisbon");
		expect(cmd.args[1]).toBe(
			"cd '/work/lisbon' || exit 1; printf '%s' 'MK'; env -0; printf '%s' 'MK'",
		);
		expect(fallbackCaptureCommand("MK", "/work/lisbon").args[1]).toBe(
			"cd '/work/lisbon' || exit 1; printf '%s' 'MK'; env -0; printf '%s' 'MK'",
		);
	});

	test("quotes a folder whose name contains an apostrophe", () => {
		const cmd = captureCommandFor("/bin/zsh", "MK", "/work/it's here");
		expect(cmd.args[1]).toBe(
			"cd '/work/it'\\''s here' || exit 1; printf '%s' 'MK'; env -0; printf '%s' 'MK'",
		);
	});

	test("caches per folder and captures each folder on its own", async () => {
		const { spawnText, calls } = recordingSpawn(() => ok(dump("M1", { PATH: "/bin" })));
		const subject = provider("/bin/zsh", spawnText, () => "M1");

		await subject.get("/work/a");
		await subject.get("/work/b");
		await subject.get("/work/a");

		expect(calls).toHaveLength(2);
		expect(calls[0]?.command.args[1]).toContain("cd '/work/a'");
		expect(calls[1]?.command.args[1]).toContain("cd '/work/b'");
	});

	test("a failure in one folder leaves the other folder's cache alone", async () => {
		const { spawnText, calls } = recordingSpawn((call) =>
			call.command.args[1]?.includes("/work/b")
				? err(appError("shell_capture_failed", "no shell here"))
				: ok(dump("M1", { PATH: "/bin" })),
		);
		const subject = provider("/bin/zsh", spawnText, () => "M1");

		expect((await subject.get("/work/a")).ok).toBe(true);
		expect((await subject.get("/work/b")).ok).toBe(false);
		expect((await subject.get("/work/a")).ok).toBe(true);
		expect(calls).toHaveLength(3);
	});
});

describe("SIDE-10 capture failure notification", () => {
	test("notifies once with the folder, kind and message after both attempts fail", async () => {
		const notices: ShellEnvFailure[] = [];
		const { spawnText, calls } = recordingSpawn(() =>
			err(appError("shell_timeout", "The login shell timed out")),
		);
		const subject = new LoginShellEnvProvider({
			spawnText,
			shellPath: "/bin/zsh",
			newMarker: markers("M1", "M2"),
			logger,
			notifyFailure: (failure) => notices.push(failure),
		});

		const result = await subject.get("/work/lisbon");

		expect(result.ok).toBe(false);
		expect(calls).toHaveLength(2);
		expect(notices).toEqual([
			{
				folder: "/work/lisbon",
				kind: "timeout",
				message: "The login shell timed out",
			},
		]);
	});

	test("does not notify when the fallback succeeds", async () => {
		const notices: ShellEnvFailure[] = [];
		const { spawnText } = recordingSpawn((call) =>
			call.timeoutMs === PRIMARY_CAPTURE_TIMEOUT_MS
				? err(appError("shell_capture_failed", "the primary shell refused"))
				: ok(dump("M2", { PATH: "/bin" })),
		);
		const subject = new LoginShellEnvProvider({
			spawnText,
			shellPath: "/bin/zsh",
			newMarker: markers("M1", "M2"),
			logger,
			notifyFailure: (failure) => notices.push(failure),
		});

		expect((await subject.get("/work/a")).ok).toBe(true);
		expect(notices).toEqual([]);
	});

	test("classifies the failure kind from the attempt's error", () => {
		const cases: [AppError, ShellEnvFailureKind][] = [
			[appError("shell_timeout", "The shell hung"), "timeout"],
			[appError("probe_failed", "The command timed out after 5000 ms"), "timeout"],
			[appError("shell_not_found", "zsh is missing"), "shell_not_found"],
			[appError("spawn_failed", "spawn /bin/zsh ENOENT"), "shell_not_found"],
			[appError("shell_capture_failed", "/bin/zsh exited with 1"), "unknown"],
		];

		expect(cases.map(([error]) => classifyShellEnvFailure(error))).toEqual(
			cases.map(([, kind]) => kind),
		);
	});
});
