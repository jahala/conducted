/**
 * @feature SIDE-25 Sidecar adapters in their own edge modules
 * Owns: tests for the process edge against real children and real timers.
 * Test first: a probe that ignores SIGTERM is killed after the grace and does not hang.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger } from "../logging/logger.ts";
import { startChild } from "../process/spawn-child.ts";
import {
	bunSpawnProbe,
	createChildSpawners,
	createIntervalScheduler,
	createProbeCommand,
	createScheduler,
	createSleep,
	createSpawnText,
	createTimeout,
	nodeTimers,
} from "./process.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempFolder(): Promise<string> {
	const folder = await mkdtemp(path.join(tmpdir(), "conducted-process-adapter-"));
	cleanups.push(() => rm(folder, { recursive: true, force: true }));
	return folder;
}

function testLogger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test",
	});
}

describe("SIDE-25 process edge", () => {
	test("SIDE-25 a probe that ignores SIGTERM is killed after the grace and does not hang", async () => {
		const probe = createProbeCommand(bunSpawnProbe, nodeTimers);
		const result = await probe("/bin/sh", ["-c", 'trap "" TERM; while :; do :; done'], {
			env: { PATH: "/usr/bin:/bin" },
			cwd: tmpdir(),
			timeoutMs: 100,
		});
		expect(result.ok).toBe(true);
	});

	test("SIDE-25 a login-shell capture returns a successful command's stdout", async () => {
		const probe = createProbeCommand(bunSpawnProbe, nodeTimers);
		const spawnText = createSpawnText(probe, () => ({ PATH: "/usr/bin:/bin" }));
		const result = await spawnText(
			{ command: "/bin/sh", args: ["-c", "printf hello"] },
			{ timeoutMs: 5_000 },
		);
		expect(result).toEqual({ ok: true, value: "hello" });
	});

	test("SIDE-25 a login-shell capture reports a command that exits non-zero", async () => {
		const probe = createProbeCommand(bunSpawnProbe, nodeTimers);
		const spawnText = createSpawnText(probe, () => ({ PATH: "/usr/bin:/bin" }));
		const result = await spawnText(
			{ command: "/bin/sh", args: ["-c", "printf bad >&2; exit 3"] },
			{ timeoutMs: 5_000 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("exited with 3");
	});

	test("SIDE-25 the Codex child spawner reads its stdout as lines", async () => {
		const folder = await tempFolder();
		const spawners = createChildSpawners(startChild, testLogger());
		const started = await spawners.spawnJsonRpcChild({
			command: "/bin/sh",
			args: ["-c", 'read line; printf "%s\\n" "$line"'],
			cwd: folder,
			env: { PATH: "/usr/bin:/bin" },
		});
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const child = started.value;
		const line = nextLine(child.onLine);
		child.writeLine("hello");
		expect(await line).toBe("hello");
		await child.stop(500);
	});

	test("SIDE-25 the ACP child spawner starts a real child and reports its exit", async () => {
		const folder = await tempFolder();
		const spawners = createChildSpawners(startChild, testLogger());
		const started = await spawners.spawnAcpChild({
			command: "/bin/sh",
			args: ["-c", "read line; exit 0"],
			cwd: folder,
			env: { PATH: "/usr/bin:/bin" },
		});
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const child = started.value;
		const exited = nextExit(child.onExit);
		const writer = child.stdin.getWriter();
		await writer.write(new TextEncoder().encode("go\n"));
		await writer.close();
		expect(await exited).toEqual({ code: 0, signal: null });
	});

	test("SIDE-25 the scheduler runs its callback after the delay", async () => {
		const scheduler = createScheduler(nodeTimers);
		const order: string[] = [];
		await new Promise<void>((resolve) => {
			scheduler.after(0, () => {
				order.push("ran");
				resolve();
			});
		});
		expect(order).toEqual(["ran"]);
	});

	test("SIDE-25 cancelling a scheduled callback stops it", async () => {
		const scheduler = createScheduler(nodeTimers);
		let fired = false;
		const cancel = scheduler.after(0, () => {
			fired = true;
		});
		cancel();
		await createSleep(nodeTimers)(10);
		expect(fired).toBe(false);
	});

	test("SIDE-25 the shutdown time limit resolves as a timeout", async () => {
		const timeout = createTimeout(nodeTimers)(0);
		expect(await timeout.done).toBe("timeout");
		timeout.cancel();
	});

	test("SIDE-25 the interval scheduler repeats until it is cancelled", async () => {
		const interval = createIntervalScheduler(nodeTimers);
		const seen: number[] = [];
		await new Promise<void>((resolve) => {
			const stop = interval.every(0, () => {
				seen.push(seen.length);
				if (seen.length === 2) {
					stop();
					resolve();
				}
			});
		});
		expect(seen).toEqual([0, 1]);
	});
});

function nextLine(register: (listener: (line: string) => void) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const timeout = createTimeout(nodeTimers)(5_000);
		register((line) => {
			timeout.cancel();
			resolve(line);
		});
		void timeout.done.then(() => reject(new Error("The child printed no line")));
	});
}

function nextExit(
	register: (listener: (code: number | null, signal: string | null) => void) => void,
): Promise<{ code: number | null; signal: string | null }> {
	return new Promise((resolve, reject) => {
		const timeout = createTimeout(nodeTimers)(5_000);
		register((code, signal) => {
			timeout.cancel();
			resolve({ code, signal });
		});
		void timeout.done.then(() => reject(new Error("The child did not exit")));
	});
}
