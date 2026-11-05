/**
 * @feature SIDE-08 Checkpoints: start before first write, end with file summary
 * Owns: proving that runCheckpointer stops a hung script and keeps its output and error.
 * Behaviour: research/conductor/sessions.md section 7 (60 s timeout, SIGTERM to the process group,
 * SIGKILL 5 s later, output and error kept up to 64 KiB) and services-map.md 3.0.2.
 * Test first: a script that ignores SIGTERM is killed after the grace period.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_LOG_LENGTH } from "./checkpoint-service.ts";
import { runCheckpointer } from "./run-checkpointer.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(script: string): Promise<{ dir: string; path: string }> {
	const dir = await mkdtemp(path.join(tmpdir(), "conducted-side.08-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const target = path.join(dir, "fixture.sh");
	await writeFile(target, `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
	return { dir, path: target };
}

function smallTimeouts() {
	return { timeoutMs: 300, killGraceMs: 200 };
}

/** For scripts that must finish: a timeout catches a hang, never a slow machine. */
function patientTimeouts() {
	return { timeoutMs: 60_000, killGraceMs: 5_000 };
}

describe("SIDE-08 run checkpointer", () => {
	test("returns the exit code and keeps stdout and stderr", async () => {
		const { dir, path: script } = await fixture(
			"printf 'out-line\\n'\nprintf 'err-line\\n' >&2\nexit 7",
		);

		const output = await runCheckpointer(["bash", script], { cwd: dir, ...patientTimeouts() });

		expect(output.exitCode).toBe(7);
		expect(output.stdout).toBe("out-line\n");
		expect(output.stderr).toBe("err-line\n");
	});

	test("keeps at most 64 KiB of each stream and drains the rest", async () => {
		const { dir, path: script } = await fixture(
			"yes x | head -c 200000\n" + "yes y | head -c 200000 >&2\n" + "exit 0",
		);

		const output = await runCheckpointer(["bash", script], { cwd: dir, ...patientTimeouts() });

		expect(output.exitCode).toBe(0);
		expect(output.truncated).toBe(true);
		expect(output.stdout).toHaveLength(MAX_LOG_LENGTH);
		expect(output.stderr).toHaveLength(MAX_LOG_LENGTH);
	});

	test("sends SIGTERM and then SIGKILL to a script that ignores SIGTERM", async () => {
		const { dir, path: script } = await fixture(
			[
				'MARKER="$(dirname "$0")/term-sent"',
				"trap 'printf term >> \"$MARKER\"' TERM",
				"for _ in $(seq 1 100); do sleep 0.05; done",
				"exit 0",
			].join("\n"),
		);

		const started = Date.now();
		const output = await runCheckpointer(["bash", script], { cwd: dir, ...smallTimeouts() });
		const elapsed = Date.now() - started;

		expect(elapsed).toBeLessThan(5_000);
		expect(output.exitCode).toBe(143);
		expect(await readFile(path.join(dir, "term-sent"), "utf8")).toContain("term");
	});

	test("stops the whole process group, not only the direct child", async () => {
		const { dir, path: script } = await fixture(
			[
				'CHILD_PID="$(dirname "$0")/child-pid"',
				"sleep 30 &",
				'printf "%s\\n" "$!" > "$CHILD_PID"',
				"wait",
			].join("\n"),
		);

		await runCheckpointer(["bash", script], { cwd: dir, ...smallTimeouts() });

		const pid = Number.parseInt(await readFile(path.join(dir, "child-pid"), "utf8"), 10);
		expect(Number.isSafeInteger(pid)).toBe(true);
		const deadline = Date.now() + 5_000;
		let alive = true;
		while (alive && Date.now() < deadline) {
			try {
				process.kill(pid, 0);
			} catch {
				alive = false;
				break;
			}
			await Bun.sleep(20);
		}
		expect(alive).toBe(false);
	});
});
