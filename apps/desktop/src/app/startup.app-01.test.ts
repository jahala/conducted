/**
 * @feature APP-01 Startup sequence
 * Owns: the database gate, the screen states reported while the container starts, and the process-wide
 * handlers that keep unhandled errors in the local log.
 * Behaviour: services-map.md part 6 (the database gate stops every later step; startup reports progress).
 * Test first: with a database marked newer than the app, runStartup reports blocked and starts no service.
 */
import { appError, err, ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Container } from "../core/container.ts";
import type { Platform } from "../platform/platform.ts";
import { installGlobalHandlers, runStartup, type StartupState } from "./startup.ts";

interface LogLine {
	level: string;
	message: string;
	data?: unknown;
}

function fakePlatform(
	logs: LogLine[],
	warning: { databaseVersion: number; appVersion: number } | null = null,
): Platform {
	return {
		app: {
			dbVersionWarning: async () => ok(warning),
			writeLog: (level: string, message: string, data?: unknown) => {
				logs.push({ level, message, data });
			},
		},
		sidecar: {
			logPath: async () => "/tmp/sidecar.log",
		},
	} as unknown as Platform;
}

function fakeContainer(platform: Platform, start: Container["start"]): Container {
	return { platform, start } as unknown as Container;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("APP-01 startup gate", () => {
	it("reports blocked and starts nothing when the database is newer than the app", async () => {
		const logs: LogLine[] = [];
		const start = vi.fn();
		const container = fakeContainer(
			fakePlatform(logs, { databaseVersion: 7, appVersion: 4 }),
			start as unknown as Container["start"],
		);
		const states: StartupState[] = [];

		const result = await runStartup(container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(result.ok).toBe(true);
		expect(start).not.toHaveBeenCalled();
		expect(states.at(-1)).toEqual({
			kind: "blocked",
			reason: "database_newer_than_app",
			databaseVersion: "7",
			appVersion: "4",
		});
	});

	it("reports the phase and the sidecar log when a start step fails", async () => {
		const logs: LogLine[] = [];
		const container = fakeContainer(
			fakePlatform(logs),
			vi.fn(async (onProgress?: (progress: { step: string; phase: "services" }) => void) => {
				onProgress?.({ step: "repos", phase: "services" });
				return err(appError("repo_failed", "The projects could not be read."));
			}) as unknown as Container["start"],
		);
		const states: StartupState[] = [];

		const result = await runStartup(container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(result.ok).toBe(false);
		expect(states.at(-1)).toEqual({
			kind: "failed",
			phase: "services",
			message: "The projects could not be read.",
			logPath: "/tmp/sidecar.log",
		});
	});

	it("reports ready after the container's ordered start", async () => {
		const logs: LogLine[] = [];
		const start = vi.fn(
			async (
				onProgress?: (progress: {
					step: string;
					phase: "settings" | "services" | "sidecar";
				}) => void,
			) => {
				onProgress?.({ step: "settings", phase: "settings" });
				onProgress?.({ step: "repos", phase: "services" });
				onProgress?.({ step: "sidecar", phase: "sidecar" });
				return ok({ warnings: [] });
			},
		);
		const container = fakeContainer(fakePlatform(logs), start as unknown as Container["start"]);
		const states: StartupState[] = [];

		const result = await runStartup(container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(start).toHaveBeenCalledTimes(1);
		expect(result.ok).toBe(true);
		expect(states).toEqual([
			{ kind: "running", phase: "database" },
			{ kind: "running", phase: "settings" },
			{ kind: "running", phase: "services" },
			{ kind: "running", phase: "sidecar" },
			{ kind: "ready" },
		]);
	});

	it("reports a failure instead of throwing when a service is not built yet", async () => {
		const logs: LogLine[] = [];
		const container = fakeContainer(
			fakePlatform(logs),
			vi.fn(async () => {
				throw new Error('Not implemented yet: "WS-01".');
			}) as unknown as Container["start"],
		);
		const states: StartupState[] = [];

		const result = await runStartup(container, (state) => states.push(state), {
			installHandlers: false,
		});

		expect(result.ok).toBe(false);
		expect(states.at(-1)).toMatchObject({
			kind: "failed",
			phase: "settings",
			message: 'Not implemented yet: "WS-01".',
		});
		expect(logs.some((line) => line.message === "Startup failed")).toBe(true);
	});
});

describe("APP-01 global handlers", () => {
	it("logs an unhandled error and an unhandled promise rejection", () => {
		const logs: LogLine[] = [];
		const dispose = installGlobalHandlers({ app: fakePlatform(logs).app });

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
		const logs: LogLine[] = [];
		const original = console.error;
		const dispose = installGlobalHandlers({ app: fakePlatform(logs).app });

		console.error("save failed", { code: "E1" });

		expect(logs).toEqual([expect.objectContaining({ level: "error", message: "console.error" })]);
		expect(String(logs[0]?.data)).toContain("save failed");
		dispose();
		expect(console.error).toBe(original);
	});

	it("stops the webview navigating to a dropped file", () => {
		const logs: LogLine[] = [];
		const dispose = installGlobalHandlers({ app: fakePlatform(logs).app });
		const drop = new Event("drop", { cancelable: true });

		window.dispatchEvent(drop);

		expect(drop.defaultPrevented).toBe(true);
		dispose();
	});
});
