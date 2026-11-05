/**
 * @feature PLAT-18 App log files and log export
 * Owns: tests for the Platform app-log group: writeLog, setLogLevel, exportLogs, and the sink
 * shared with the slow-statement database log.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A7, services-map.md 1.1 and
 * 5B.11.4, docs/plans/tauri-commands.md.
 */

import { describe, expect, it } from "vitest";
import { COMMANDS, createAppLogSink, createTauriAppInfo, type TauriBindings } from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

function fakeBindings(handler: (command: string, args?: Record<string, unknown>) => unknown) {
	const calls: Call[] = [];
	const bindings: TauriBindings = {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
			calls.push({ command, args });
			return handler(command, args) as T;
		},
		listen: async () => () => {},
	};
	return { bindings, calls };
}

function appFor(handler: (command: string, args?: Record<string, unknown>) => unknown) {
	const { bindings, calls } = fakeBindings(handler);
	const app = createTauriAppInfo(bindings, { version: "0.1.0", channel: "dev" });
	return { app, calls };
}

describe("PLAT-18 Tauri app log", () => {
	it("PLAT-18 writeLog sends the level, message and data to log_write", () => {
		const { app, calls } = appFor(() => undefined);

		app.writeLog("warn", "The settings reload failed", { key: "theme" });

		expect(calls).toEqual([
			{
				command: COMMANDS.logWrite,
				args: {
					record: {
						level: "warn",
						message: "The settings reload failed",
						data: { key: "theme" },
					},
				},
			},
		]);
	});

	it("PLAT-18 writeLog never throws on a value that cannot be serialised", () => {
		const { app, calls } = appFor(() => undefined);
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		expect(() => app.writeLog("info", "contract", circular)).not.toThrow();

		expect(calls).toEqual([
			{
				command: COMMANDS.logWrite,
				args: {
					record: { level: "info", message: "contract", data: "[unserialisable]" },
				},
			},
		]);
	});

	it("PLAT-18 writeLog leaves data out when there is none", () => {
		const { app, calls } = appFor(() => undefined);

		app.writeLog("debug", "plain");

		expect(calls[0]?.args).toEqual({
			record: { level: "debug", message: "plain" },
		});
	});

	it("PLAT-18 setLogLevel sends log_set_level and throws the command error", async () => {
		const { app, calls } = appFor(() => undefined);
		await app.setLogLevel("debug");
		expect(calls).toEqual([{ command: COMMANDS.logSetLevel, args: { level: "debug" } }]);

		const { app: failing } = appFor(() => {
			throw { code: "log_bad_level", message: "Unknown log level." };
		});
		await expect(failing.setLogLevel("loud" as never)).rejects.toEqual({
			code: "log_bad_level",
			message: "Unknown log level.",
		});
	});

	it("PLAT-18 exportLogs returns the path and turns a rejection into an Err", async () => {
		const path = "/data/exports/conducted-logs-1.ndjson";
		const { app } = appFor(() => path);
		await expect(app.exportLogs()).resolves.toEqual({ ok: true, value: path });

		const { app: failing } = appFor(() => {
			throw { code: "log_export_task_failed", message: "The disk is full." };
		});
		const result = await failing.exportLogs();
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("log_export_task_failed");
	});

	it("PLAT-18 the slow-statement sink is the same app.writeLog", () => {
		const { app, calls } = appFor(() => undefined);
		const sink = createAppLogSink(app);

		sink("warn", "Slow SQLite call", { sql: "SELECT 1" });

		expect(calls).toEqual([
			{
				command: COMMANDS.logWrite,
				args: {
					record: {
						level: "warn",
						message: "Slow SQLite call",
						data: { sql: "SELECT 1" },
					},
				},
			},
		]);
	});
});
