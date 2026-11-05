import { describe, expect, it } from "vitest";
import { openTestDatabase } from "../test/sqlite.ts";
import { createMemoryPlatform } from "./memory.ts";
import { COMMANDS, createTauriSystem, type TauriBindings } from "./tauri.ts";

describe("PLAT-32 in-memory system facts", () => {
	it("PLAT-32 reports the macOS version and CPU facts a test set for the Mac", async () => {
		const store = openTestDatabase();
		let nextId = 0;
		try {
			const memory = createMemoryPlatform({
				clock: { now: () => 0 },
				ids: { uuid: () => `system-fact-${++nextId}` },
				database: store.database,
			});
			const info = { osVersion: "13.6.1", machineArch: "arm64", buildArch: "x86_64" } as const;
			memory.controls.setSystemInfo(info);

			await expect(memory.platform.system.info()).resolves.toEqual(info);
		} finally {
			store.close();
		}
	});

	it("PLAT-32 fails the info read when a test makes the shell fail", async () => {
		const store = openTestDatabase();
		let nextId = 0;
		try {
			const memory = createMemoryPlatform({
				clock: { now: () => 0 },
				ids: { uuid: () => `system-fact-${++nextId}` },
				database: store.database,
			});
			memory.controls.failSystemInfo("sw_vers is missing");

			await expect(memory.platform.system.info()).rejects.toThrow("sw_vers is missing");
		} finally {
			store.close();
		}
	});
});

describe("PLAT-32 Tauri system facts", () => {
	it("PLAT-32 asks the system_info command and returns its answer", async () => {
		const calls: string[] = [];
		const info = { osVersion: "15.4.1", machineArch: "arm64", buildArch: "x86_64" } as const;
		const bindings: TauriBindings = {
			invoke: async <T>(command: string): Promise<T> => {
				calls.push(command);
				return info as T;
			},
			listen: async () => () => {},
		};

		await expect(createTauriSystem(bindings).info()).resolves.toEqual(info);
		expect(calls).toEqual([COMMANDS.systemInfo]);
	});

	it("PLAT-32 passes a failed system_info command on instead of inventing facts", async () => {
		const failure = { code: "system_info_failed", message: "sw_vers is missing" };
		const bindings: TauriBindings = {
			invoke: async <T>(): Promise<T> => {
				throw failure;
			},
			listen: async () => () => {},
		};

		await expect(createTauriSystem(bindings).info()).rejects.toEqual(failure);
	});
});
