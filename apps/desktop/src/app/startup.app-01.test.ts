/**
 * @feature APP-01 Startup sequence
 * Owns: the database gate, the screen states reported while the container starts, and the process-wide
 * handlers that keep unhandled errors in the local log.
 * Behaviour: services-map.md part 6 (the database gate stops every later step; startup reports progress).
 * Test first: with a database marked newer than the app, runStartup reports blocked and starts no service.
 */
import { appError, err, ok } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { installGlobalHandlers, runStartup, type StartupState } from "./startup.ts";

interface LogLine {
	level: string;
	message: string;
	data?: unknown;
}

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	vi.restoreAllMocks();
	test.close();
});

/** Records every log line, including the data a test asserts on, as the app's log does. */
function recordLogs(): LogLine[] {
	const logs: LogLine[] = [];
	vi.spyOn(test.container.platform.app, "writeLog").mockImplementation((level, message, data) => {
		logs.push({ level, message, data });
	});
	return logs;
}

const start = () => vi.spyOn(test.container, "start");

describe("APP-01 startup gate", () => {
	it("reports blocked and starts nothing when the database is newer than the app", async () => {
		recordLogs();
		vi.spyOn(test.container.platform.app, "dbVersionWarning").mockResolvedValue(
			ok({ databaseVersion: 7, appVersion: 4 }),
		);
		const startSpy = start();
		const states: StartupState[] = [];

		const result = await runStartup(test.container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(result.ok).toBe(true);
		expect(startSpy).not.toHaveBeenCalled();
		expect(states.at(-1)).toEqual({
			kind: "blocked",
			reason: "database_newer_than_app",
			databaseVersion: "7",
			appVersion: "4",
		});
	});

	it("reports the phase and the sidecar log when a start step fails", async () => {
		recordLogs();
		start().mockImplementation(async (onProgress) => {
			onProgress?.({ step: "repos", phase: "services" });
			return err(appError("repo_failed", "The projects could not be read."));
		});
		const states: StartupState[] = [];

		const result = await runStartup(test.container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(result.ok).toBe(false);
		expect(states.at(-1)).toEqual({
			kind: "failed",
			phase: "services",
			message: "The projects could not be read.",
			logPath: `${test.container.platform.fs.paths.appData}/sidecar.log`,
		});
	});

	it("logs why the sidecar log path is missing when the Platform cannot give it", async () => {
		const logs = recordLogs();
		vi.spyOn(test.container.platform.sidecar, "logPath").mockRejectedValue(
			new Error("no log directory"),
		);
		start().mockImplementation(async () =>
			err(appError("sidecar_failed", "The agent sidecar did not start.")),
		);
		const states: StartupState[] = [];

		await runStartup(test.container, (state) => states.push(state), { installHandlers: false });

		expect(states.at(-1)).toMatchObject({ kind: "failed", logPath: null });
		expect(logs).toContainEqual({
			level: "warn",
			message: "The sidecar log path could not be read",
			data: { message: "no log directory" },
		});
	});

	it("reports a sidecar that does not start as failed, with its log path", async () => {
		recordLogs();
		start().mockImplementation(async (onProgress) => {
			onProgress?.({ step: "sidecar", phase: "sidecar" });
			return err(appError("sidecar_failed", "The agent sidecar did not start."));
		});
		const states: StartupState[] = [];

		const result = await runStartup(test.container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(result.ok).toBe(false);
		expect(states.at(-1)).toEqual({
			kind: "failed",
			phase: "sidecar",
			message: "The agent sidecar did not start.",
			logPath: `${test.container.platform.fs.paths.appData}/sidecar.log`,
		});
	});

	it("reports ready after the container's ordered start", async () => {
		recordLogs();
		const startSpy = start().mockImplementation(async (onProgress) => {
			onProgress?.({ step: "settings", phase: "settings" });
			onProgress?.({ step: "repos", phase: "services" });
			onProgress?.({ step: "sidecar", phase: "sidecar" });
			return ok({ warnings: [] });
		});
		const states: StartupState[] = [];

		const result = await runStartup(test.container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(startSpy).toHaveBeenCalledTimes(1);
		expect(result.ok).toBe(true);
		expect(states).toEqual([
			{ kind: "running", phase: "database" },
			{ kind: "running", phase: "settings" },
			{ kind: "running", phase: "services" },
			{ kind: "running", phase: "sidecar" },
			{ kind: "ready" },
		]);
	});

	it("reports a failure instead of throwing when a start step throws", async () => {
		const logs = recordLogs();
		start().mockImplementation(async () => {
			throw new Error("The settings file could not be read.");
		});
		const states: StartupState[] = [];

		const result = await runStartup(test.container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(result.ok).toBe(false);
		expect(states.at(-1)).toMatchObject({
			kind: "failed",
			phase: "settings",
			message: "The settings file could not be read.",
		});
		expect(logs.some((line) => line.message === "Startup failed")).toBe(true);
	});
});

describe("APP-01 global handlers", () => {
	it("logs an unhandled error and an unhandled promise rejection", () => {
		const logs = recordLogs();
		const dispose = installGlobalHandlers({ app: test.container.platform.app });

		window.dispatchEvent(
			new ErrorEvent("error", { message: "render broke", error: new Error("render broke") }),
		);
		const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
		Object.defineProperty(rejection, "reason", { value: new Error("load broke") });
		window.dispatchEvent(rejection);

		expect(logs.map((line) => line.message)).toEqual([
			"Unhandled error",
			"Unhandled promise rejection",
		]);
		dispose();
	});

	it("forwards console.error into the local log and restores it afterwards", () => {
		const logs = recordLogs();
		const original = console.error;
		const dispose = installGlobalHandlers({ app: test.container.platform.app });

		console.error("save failed", { code: "E1" });

		expect(logs).toEqual([expect.objectContaining({ level: "error", message: "console.error" })]);
		expect(String(logs[0]?.data)).toContain("save failed");
		dispose();
		expect(console.error).toBe(original);
	});

	it("stops the webview navigating to a dropped file", () => {
		recordLogs();
		const dispose = installGlobalHandlers({ app: test.container.platform.app });
		const drop = new Event("drop", { cancelable: true });

		window.dispatchEvent(drop);

		expect(drop.defaultPrevented).toBe(true);
		dispose();
	});
});
