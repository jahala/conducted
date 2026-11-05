import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentInstall } from "@conducted/protocol";
import { systemClock } from "@conducted/shared";
import type { SidecarConfig } from "../config.ts";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import {
	announceAgentInstalls,
	createPromptFiles,
	createScheduler,
	EXIT_START_FAILED,
	installErrorHandlers,
	type ProcessErrorHooks,
	preflightDirectories,
	runSidecarMode,
	type SidecarHostInput,
	type SidecarModeIo,
	stderrLogSink,
} from "./sidecar-mode.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempDir(prefix: string): Promise<string> {
	const created = await mkdtemp(path.join(tmpdir(), `conducted-side.01-${prefix}-`));
	cleanups.push(() => rm(created, { recursive: true, force: true }));
	return created;
}

function envFor(config: SidecarConfig): Record<string, string> {
	return {
		CONDUCTED_BIN_DIR: config.binDir,
		CONDUCTED_OUTBOX_ROOT: config.outboxRoot,
		CONDUCTED_LOG_DIR: config.logDir,
	};
}

function recordingLogger(): { logger: ReturnType<typeof createLogger>; records: LogRecord[] } {
	const records: LogRecord[] = [];
	return {
		logger: createLogger({
			sink: (record) => records.push(record),
			clock: systemClock,
			level: "debug",
			scope: "test",
		}),
		records,
	};
}

function fakeIo(
	overrides: Partial<SidecarModeIo> & { records?: LogRecord[] } = {},
): SidecarModeIo & { started: SidecarHostInput[] } {
	const started: SidecarHostInput[] = [];
	const { logger } = recordingLogger();
	return {
		started,
		writeError: () => {},
		writeOut: () => {},
		createLogger: () => logger,
		preflight: async () => ({ ok: true, value: undefined }),
		installErrorHandlers: () => () => {},
		startHost: async (input) => {
			started.push(input);
			return 0;
		},
		...overrides,
	};
}

describe("SIDE-01 sidecar mode", () => {
	test("SIDE-01 starts the agent host with the settings from the environment", async () => {
		const base = await tempDir("start");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			logDir: path.join(base, "logs"),
		};
		const io = fakeIo();
		const code = await runSidecarMode(envFor(config), ["sidecar"], io);
		expect(code).toBe(0);
		expect(io.started).toHaveLength(1);
		expect(io.started[0]?.config).toEqual(config);
	});

	test("SIDE-01 an unwritable outbox folder exits 1 and names the folder", async () => {
		const base = await tempDir("readonly");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			logDir: path.join(base, "logs"),
		};
		await mkdir(config.binDir, { recursive: true });
		await mkdir(config.outboxRoot, { recursive: true });
		await mkdir(config.logDir, { recursive: true });
		await chmod(config.outboxRoot, 0o500);
		let error = "";
		const io = fakeIo({
			preflight: preflightDirectories,
			writeError: (text) => {
				error += text;
			},
		});
		try {
			const code = await runSidecarMode(envFor(config), ["sidecar"], io);
			expect(code).toBe(EXIT_START_FAILED);
			expect(error).toContain(config.outboxRoot);
			expect(io.started).toEqual([]);
		} finally {
			await chmod(config.outboxRoot, 0o700);
		}
	});

	test("SIDE-01 a missing environment variable exits 64 without starting the host", async () => {
		const io = fakeIo();
		let error = "";
		const code = await runSidecarMode(
			{ CONDUCTED_OUTBOX_ROOT: "/tmp/outbox", CONDUCTED_LOG_DIR: "/tmp/logs" },
			["sidecar"],
			{ ...io, writeError: (text) => (error += text) },
		);
		expect(code).toBe(64);
		expect(error).toContain("CONDUCTED_BIN_DIR");
		expect(io.started).toEqual([]);
	});

	test("SIDE-01 reads every path from the environment and never defaults to ~/.conductor", async () => {
		const io = fakeIo();
		const code = await runSidecarMode({ HOME: "/Users/someone" }, ["sidecar"], io);
		expect(code).toBe(64);
		expect(io.started).toEqual([]);
	});
});

describe("SIDE-01 process error handlers", () => {
	test("SIDE-01 an uncaught exception is logged and the handler stays installed", () => {
		const { logger, records } = recordingLogger();
		const hooks = new FakeHooks();
		const remove = installErrorHandlers(logger, hooks);
		hooks.emit("uncaughtException", new Error("boom"));
		expect(records).toHaveLength(1);
		expect(records[0]?.level).toBe("error");
		expect(records[0]?.message).toContain("Uncaught exception");
		expect(records[0]?.data?.reason).toBe("boom");
		remove();
		expect(hooks.listenerCount("uncaughtException")).toBe(0);
	});

	test("SIDE-01 an unhandled rejection is logged and the handler stays installed", () => {
		const { logger, records } = recordingLogger();
		const hooks = new FakeHooks();
		const remove = installErrorHandlers(logger, hooks);
		hooks.emit("unhandledRejection", "not a promise");
		expect(records).toHaveLength(1);
		expect(records[0]?.level).toBe("error");
		expect(records[0]?.message).toContain("Unhandled promise rejection");
		expect(records[0]?.data?.reason).toBe("not a promise");
		remove();
		expect(hooks.listenerCount("unhandledRejection")).toBe(0);
	});

	test("SIDE-01 the log sink writes one JSON object per line", () => {
		const lines: string[] = [];
		const sink = stderrLogSink((text) => lines.push(text));
		sink({ at: 1, level: "info", scope: "test", message: "hello", data: { a: 1 } });
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] ?? "")).toEqual({
			at: 1,
			level: "info",
			scope: "test",
			message: "hello",
			data: { a: 1 },
		});
	});
});

describe("SIDE-01 agent detection and the model catalog", () => {
	test("SIDE-01 invalidates the model cache before telling the app the agent list changed", () => {
		const order: string[] = [];
		const { logger } = recordingLogger();
		const installs: AgentInstall[] = [{ agent: "claude", installed: true }];
		announceAgentInstalls(
			{
				models: { invalidate: () => order.push("invalidate") },
				app: {
					notify: () => {
						order.push("notify");
						return true;
					},
				},
				logger,
			},
			installs,
		);
		expect(order).toEqual(["invalidate", "notify"]);
	});
});

describe("SIDE-01 composition ports", () => {
	test("SIDE-01 the prompt file port reads a file's size and text", async () => {
		const base = await tempDir("files");
		const target = path.join(base, "note.md");
		await writeFile(target, "hello", "utf8");
		const files = createPromptFiles();
		expect(await files.size(target)).toBe(5);
		expect(await files.readText(target)).toEqual({ ok: true, value: "hello" });
	});

	test("SIDE-01 the prompt file port reports a missing file as no size and an error", async () => {
		const base = await tempDir("missing");
		const target = path.join(base, "gone.md");
		const files = createPromptFiles();
		expect(await files.size(target)).toBeNull();
		const read = await files.readText(target);
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.error.message).toContain(target);
	});

	test("SIDE-01 the scheduler runs its callback after the delay", async () => {
		const scheduler = createScheduler();
		await new Promise<void>((resolve, reject) => {
			const guard = setTimeout(() => reject(new Error("The scheduler did not run")), 1_000);
			scheduler.after(0, () => {
				clearTimeout(guard);
				resolve();
			});
		});
	});

	test("SIDE-01 cancelling a scheduled callback stops it", async () => {
		const scheduler = createScheduler();
		const fired: string[] = [];
		await new Promise<void>((resolve, reject) => {
			const guard = setTimeout(() => reject(new Error("The follow-up did not run")), 1_000);
			const cancel = scheduler.after(0, () => fired.push("cancelled"));
			cancel();
			scheduler.after(0, () => {
				clearTimeout(guard);
				resolve();
			});
		});
		expect(fired).toEqual([]);
	});
});

class FakeHooks implements ProcessErrorHooks {
	private readonly listeners = {
		uncaughtException: new Set<(error: unknown) => void>(),
		unhandledRejection: new Set<(reason: unknown) => void>(),
	};

	on(
		event: "uncaughtException" | "unhandledRejection",
		listener: ((error: unknown) => void) | ((reason: unknown) => void),
	): void {
		if (event === "uncaughtException") {
			this.listeners.uncaughtException.add(listener as (error: unknown) => void);
		} else {
			this.listeners.unhandledRejection.add(listener as (reason: unknown) => void);
		}
	}

	off(
		event: "uncaughtException" | "unhandledRejection",
		listener: ((error: unknown) => void) | ((reason: unknown) => void),
	): void {
		if (event === "uncaughtException") {
			this.listeners.uncaughtException.delete(listener as (error: unknown) => void);
		} else {
			this.listeners.unhandledRejection.delete(listener as (reason: unknown) => void);
		}
	}

	emit(event: "uncaughtException" | "unhandledRejection", value: unknown): void {
		if (event === "uncaughtException") {
			for (const listener of this.listeners.uncaughtException) listener(value);
		} else {
			for (const listener of this.listeners.unhandledRejection) listener(value);
		}
	}

	listenerCount(event: "uncaughtException" | "unhandledRejection"): number {
		return this.listeners[event].size;
	}
}
