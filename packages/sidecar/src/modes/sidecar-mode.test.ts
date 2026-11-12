import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentInstall } from "@conducted/protocol";
import { appError, err, ok, systemClock } from "@conducted/shared";
import {
	createLoginShellEnvProvider,
	createProcessEnvironment,
	newEnvironmentMarker,
	nodeProcessFacts,
} from "../adapters/environment.ts";
import { createNodeFilesAdapters } from "../adapters/files.ts";
import {
	bunSpawnProbe,
	createProbeCommand,
	createScheduler,
	createSpawnText,
	nodeTimers,
	PROBE_KILL_GRACE_MS,
	type ProcessErrorHooks,
} from "../adapters/process.ts";
import type { SidecarConfig } from "../config.ts";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import type { ShutdownStep } from "../shutdown.ts";
import {
	announceAgentInstalls,
	createDefaultIo,
	EXIT_START_FAILED,
	handleAppAttached,
	installErrorHandlers,
	refreshAgentInstalls,
	runSidecarMode,
	runStartupSteps,
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

const TEST_LOG_LEVEL = "info";
const TEST_APP_VERSION = "1.2.3";

function envFor(
	config: Pick<
		SidecarConfig,
		"binDir" | "agentBinariesDir" | "outboxRoot" | "completionsDir" | "cursorStoreDir" | "logDir"
	>,
): Record<string, string> {
	return {
		CONDUCTED_BIN_DIR: config.binDir,
		CONDUCTED_OUTBOX_ROOT: config.outboxRoot,
		CONDUCTED_COMPLETIONS_DIR: config.completionsDir,
		CONDUCTED_CURSOR_STORE_DIR: config.cursorStoreDir,
		CONDUCTED_AGENT_BINARIES_DIR: config.agentBinariesDir,
		CONDUCTED_LOG_DIR: config.logDir,
		CONDUCTED_APP_VERSION: TEST_APP_VERSION,
		CONDUCTED_LOG_LEVEL: TEST_LOG_LEVEL,
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
			completionsDir: path.join(base, "completions"),
			cursorStoreDir: path.join(base, "cursor-sdk-store"),
			agentBinariesDir: path.join(base, "agent-binaries"),
			logDir: path.join(base, "logs"),
		};
		const io = fakeIo();
		const code = await runSidecarMode(envFor(config), ["sidecar"], io);
		expect(code).toBe(0);
		expect(io.started).toHaveLength(1);
		expect(io.started[0]?.config).toEqual({
			...config,
			appVersion: TEST_APP_VERSION,
			logLevel: TEST_LOG_LEVEL,
			cloudMcpServers: [],
		});
	});

	test("SIDE-01 an unwritable outbox folder exits 1 and names the folder", async () => {
		const base = await tempDir("readonly");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			completionsDir: path.join(base, "completions"),
			cursorStoreDir: path.join(base, "cursor-sdk-store"),
			agentBinariesDir: path.join(base, "agent-binaries"),
			logDir: path.join(base, "logs"),
		};
		await mkdir(config.binDir, { recursive: true });
		await mkdir(config.outboxRoot, { recursive: true });
		await mkdir(config.logDir, { recursive: true });
		await chmod(config.outboxRoot, 0o500);
		let error = "";
		const io = fakeIo({
			preflight: createNodeFilesAdapters({}).preflight,
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

describe("SIDE-18 sidecar logging", () => {
	test("SIDE-18 the logger takes its level and app version from the launcher's environment", async () => {
		const base = await tempDir("log-settings");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			completionsDir: path.join(base, "completions"),
			cursorStoreDir: path.join(base, "cursor-sdk-store"),
			agentBinariesDir: path.join(base, "agent-binaries"),
			logDir: path.join(base, "logs"),
		};
		const received: SidecarConfig[] = [];
		const io = fakeIo({
			createLogger: (parsed) => {
				received.push(parsed);
				return recordingLogger().logger;
			},
		});
		const code = await runSidecarMode(
			{
				...envFor(config),
				CONDUCTED_LOG_LEVEL: "debug",
				CONDUCTED_APP_VERSION: "9.9.9",
			},
			["sidecar"],
			io,
		);
		expect(code).toBe(0);
		expect(received[0]).toMatchObject({ logLevel: "debug", appVersion: "9.9.9" });
	});

	test("SIDE-18 the mode writes a startup line carrying the app version", async () => {
		const base = await tempDir("log-start");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			completionsDir: path.join(base, "completions"),
			cursorStoreDir: path.join(base, "cursor-sdk-store"),
			agentBinariesDir: path.join(base, "agent-binaries"),
			logDir: path.join(base, "logs"),
		};
		const { logger, records } = recordingLogger();
		const io = fakeIo({ createLogger: () => logger });

		await runSidecarMode(envFor(config), ["sidecar"], io);

		expect(records).toContainEqual(
			expect.objectContaining({
				message: "The sidecar is starting",
				data: expect.objectContaining({
					appVersion: TEST_APP_VERSION,
					logLevel: TEST_LOG_LEVEL,
				}),
			}),
		);
	});
	test("SIDE-18 the mode's own logger turns console output into redacted JSON lines on stderr, folding repeats", async () => {
		const base = await tempDir("log-wiring");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			completionsDir: path.join(base, "completions"),
			cursorStoreDir: path.join(base, "cursor-sdk-store"),
			agentBinariesDir: path.join(base, "agent-binaries"),
			logDir: path.join(base, "logs"),
		};
		const stderr: string[] = [];
		const io: SidecarModeIo = {
			...createDefaultIo({ writeError: (text) => stderr.push(text), writeOut: () => {} }),
			preflight: async () => ok(undefined),
			installErrorHandlers: () => () => {},
			startHost: async (input) => {
				console.log("from the console", { step: 1 });
				console.error("the same failure");
				console.error("the same failure");
				input.logger.info("an agent environment", {
					env: { GH_TOKEN: "ghp-secret", HOME: "/home/me" },
				});
				return 0;
			},
		};

		expect(await runSidecarMode(envFor(config), ["sidecar"], io)).toBe(0);

		const records = stderr
			.join("")
			.split("\n")
			.filter((line) => line !== "")
			.map((line) => JSON.parse(line) as LogRecord);
		expect(records).toContainEqual(
			expect.objectContaining({
				level: "info",
				scope: "sidecar:console",
				message: 'from the console {"step":1}',
			}),
		);
		expect(
			records
				.filter((record) => record.message.startsWith("the same failure"))
				.map((record) => record.message),
		).toEqual(["the same failure", "the same failure (repeated 1 time)"]);
		expect(records).toContainEqual(
			expect.objectContaining({
				message: "an agent environment",
				data: { env: { GH_TOKEN: "<redacted:10>", HOME: "/home/me" } },
			}),
		);
		expect(stderr.join("")).not.toContain("ghp-secret");
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
		const files = createNodeFilesAdapters({}).promptFiles;
		expect(await files.size(target)).toBe(5);
		expect(await files.readText(target)).toEqual({ ok: true, value: "hello" });
	});

	test("SIDE-01 the prompt file port reports a missing file as no size and an error", async () => {
		const base = await tempDir("missing");
		const target = path.join(base, "gone.md");
		const files = createNodeFilesAdapters({}).promptFiles;
		expect(await files.size(target)).toBeNull();
		const read = await files.readText(target);
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.error.message).toContain(target);
	});

	test("SIDE-01 the scheduler runs its callback after the delay", async () => {
		const scheduler = createScheduler(nodeTimers);
		await new Promise<void>((resolve, reject) => {
			const guard = setTimeout(() => reject(new Error("The scheduler did not run")), 1_000);
			scheduler.after(0, () => {
				clearTimeout(guard);
				resolve();
			});
		});
	});

	test("SIDE-01 cancelling a scheduled callback stops it", async () => {
		const scheduler = createScheduler(nodeTimers);
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

describe("SIDE-01 startup steps", () => {
	test("SIDE-01 a failing step stops every step that started, newest first", async () => {
		const order: string[] = [];
		const shutdownCalls: string[][] = [];
		const result = await runStartupSteps(
			[
				{
					name: "outbox",
					run: async () => {
						order.push("outbox");
						return ok(undefined);
					},
					undo: () => ({
						name: "flush events",
						limitMs: 10,
						run: async () => {
							order.push("flush events");
						},
					}),
				},
				{
					name: "bridge",
					run: async () => {
						order.push("bridge");
						return ok(undefined);
					},
					undo: () => ({
						name: "close bridge",
						limitMs: 10,
						run: async () => {
							order.push("close bridge");
						},
					}),
				},
				{
					name: "socket",
					run: async () => {
						order.push("socket");
						return err(appError("listen_failed", "no socket"));
					},
					undo: () => ({ name: "close socket", limitMs: 10, run: async () => {} }),
				},
			],
			{
				runShutdown: async (steps: readonly ShutdownStep[]) => {
					shutdownCalls.push(steps.map((step) => step.name));
					for (const step of steps) await step.run();
					return { completed: [], failed: [] };
				},
			},
		);
		expect(result.ok).toBe(false);
		expect(order).toEqual(["outbox", "bridge", "socket", "close bridge", "flush events"]);
		expect(shutdownCalls).toEqual([["close bridge", "flush events"]]);
	});

	test("SIDE-01 a start where every step passes runs no shutdown step", async () => {
		const shutdownCalls: ShutdownStep[][] = [];
		const result = await runStartupSteps(
			[
				{
					name: "one",
					run: async () => ok(1),
					undo: () => ({ name: "u1", limitMs: 1, run: async () => {} }),
				},
				{
					name: "two",
					run: async () => ok(2),
					undo: () => ({ name: "u2", limitMs: 1, run: async () => {} }),
				},
			],
			{
				runShutdown: async (steps) => {
					shutdownCalls.push([...steps]);
					return { completed: [], failed: [] };
				},
			},
		);
		expect(result).toEqual({ ok: true, value: undefined });
		expect(shutdownCalls).toEqual([]);
	});
});

describe("SIDE-01 startup agent detection", () => {
	test("SIDE-01 a detector that rejects is logged and does not fail the start", async () => {
		const { logger, records } = recordingLogger();
		await expect(
			refreshAgentInstalls({
				agents: {
					detectAll: async () => {
						throw new Error("probe hung");
					},
				},
				logger,
			}),
		).resolves.toBeUndefined();
		expect(records.some((record) => record.level === "warn")).toBe(true);
		expect(records.some((record) => record.data?.reason === "probe hung")).toBe(true);
	});
});

describe("SIDE-01 startup error handler wiring", () => {
	test("SIDE-01 the mode installs the error handlers before the host and removes them after", async () => {
		const base = await tempDir("wiring");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			completionsDir: path.join(base, "completions"),
			cursorStoreDir: path.join(base, "cursor-sdk-store"),
			agentBinariesDir: path.join(base, "agent-binaries"),
			logDir: path.join(base, "logs"),
		};
		const events: string[] = [];
		const io = fakeIo({
			installErrorHandlers: () => {
				events.push("install");
				return () => events.push("remove");
			},
			startHost: async () => {
				events.push("start");
				return 0;
			},
		});
		await runSidecarMode(envFor(config), ["sidecar"], io);
		expect(events).toEqual(["install", "start", "remove"]);
	});

	test("SIDE-01 the handlers are removed when the host throws", async () => {
		const base = await tempDir("wiring-throws");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			completionsDir: path.join(base, "completions"),
			cursorStoreDir: path.join(base, "cursor-sdk-store"),
			agentBinariesDir: path.join(base, "agent-binaries"),
			logDir: path.join(base, "logs"),
		};
		const events: string[] = [];
		const io = fakeIo({
			installErrorHandlers: () => {
				events.push("install");
				return () => events.push("remove");
			},
			startHost: async () => {
				events.push("start");
				throw new Error("kaboom");
			},
		});
		await expect(runSidecarMode(envFor(config), ["sidecar"], io)).rejects.toThrow("kaboom");
		expect(events).toEqual(["install", "start", "remove"]);
	});

	test("SIDE-01 the default wiring adds and removes listeners on the process", () => {
		const { logger } = recordingLogger();
		const beforeException = process.listenerCount("uncaughtException");
		const beforeRejection = process.listenerCount("unhandledRejection");
		const remove = installErrorHandlers(logger);
		expect(process.listenerCount("uncaughtException")).toBe(beforeException + 1);
		expect(process.listenerCount("unhandledRejection")).toBe(beforeRejection + 1);
		remove();
		expect(process.listenerCount("uncaughtException")).toBe(beforeException);
		expect(process.listenerCount("unhandledRejection")).toBe(beforeRejection);
	});
});

describe("SIDE-01 startup folders", () => {
	test("SIDE-01 an unwritable log folder is not probed, because nothing writes it yet", async () => {
		const base = await tempDir("log-folder");
		const config = {
			binDir: path.join(base, "bin"),
			outboxRoot: path.join(base, "outbox"),
			completionsDir: path.join(base, "completions"),
			cursorStoreDir: path.join(base, "cursor-sdk-store"),
			agentBinariesDir: path.join(base, "agent-binaries"),
			logDir: path.join(base, "logs"),
		};
		await mkdir(config.binDir, { recursive: true });
		await mkdir(config.outboxRoot, { recursive: true });
		await mkdir(config.logDir, { recursive: true });
		await chmod(config.logDir, 0o500);
		try {
			expect(await createNodeFilesAdapters({}).preflight(config)).toEqual({
				ok: true,
				value: undefined,
			});
		} finally {
			await chmod(config.logDir, 0o700);
		}
	});
});

describe("SIDE-11 a new app connection", () => {
	test("SIDE-11 replays the log and resends the open interactions", () => {
		const calls: string[] = [];
		const { logger } = recordingLogger();
		handleAppAttached({
			replayer: {
				replayAll: async () => {
					calls.push("replay");
				},
			},
			sessions: {
				onAppAttached: () => {
					calls.push("resend");
				},
			},
			logger,
		});

		expect(calls).toEqual(["replay", "resend"]);
	});
});

describe("SIDE-10 shell capture failures reach the app", () => {
	test("SIDE-10 a capture that fails in both shells sends shellEnvFailed with the folder", async () => {
		const { logger } = recordingLogger();
		const failures: unknown[] = [];
		const environment = createProcessEnvironment(nodeProcessFacts);
		const probe = createProbeCommand(bunSpawnProbe, nodeTimers);
		const provider = createLoginShellEnvProvider({
			launcherEnv: { SHELL: "/bin/sh" },
			logger,
			notifyFailure: (failure) => {
				failures.push(failure);
			},
			spawnText: createSpawnText(probe, environment.snapshot),
			newMarker: newEnvironmentMarker,
		});

		// A folder that does not exist makes the capture script fail in every shell.
		const missing = path.join(tmpdir(), "conducted-side10-no-such-folder");
		const result = await provider.get(missing);

		expect(result.ok).toBe(false);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({ folder: missing });
	});
});

describe("SIDE-01 command probes", () => {
	test("SIDE-01 a probe that ignores SIGTERM is killed after the grace and does not hang", async () => {
		const started = Date.now();
		const probe = createProbeCommand(bunSpawnProbe, nodeTimers);
		const result = await probe("/bin/sh", ["-c", 'trap "" TERM; while :; do :; done'], {
			env: { PATH: "/usr/bin:/bin" },
			cwd: tmpdir(),
			timeoutMs: 100,
		});
		expect(result.ok).toBe(true);
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(PROBE_KILL_GRACE_MS).toBeGreaterThan(0);
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
