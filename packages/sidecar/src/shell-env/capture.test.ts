import { describe, expect, test } from "bun:test";
import type { Result } from "@conducted/shared";
import { err, ok } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import {
	type CaptureCommand,
	captureCommandFor,
	FALLBACK_CAPTURE_TIMEOUT_MS,
	fallbackCaptureCommand,
	LoginShellEnvProvider,
	PRIMARY_CAPTURE_TIMEOUT_MS,
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

		const result = await provider("/bin/tcsh", spawnText).get();

		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.timeoutMs).toBe(FALLBACK_CAPTURE_TIMEOUT_MS);
		expect(calls[0]?.command).toEqual(fallbackCaptureCommand("M1"));
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
});
