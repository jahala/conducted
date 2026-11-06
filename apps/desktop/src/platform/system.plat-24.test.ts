import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriSystem, type TauriBindings } from "./tauri.ts";

function bindingsInvoking(
	invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
): TauriBindings {
	return { invoke, listen: async () => () => {} };
}

describe("PLAT-24 Tauri Full Disk Access", () => {
	it("PLAT-24 asks the full_disk_access_check command and returns its answer", async () => {
		const calls: string[] = [];
		const bindings = bindingsInvoking(async <T>(command: string): Promise<T> => {
			calls.push(command);
			return true as T;
		});

		await expect(createTauriSystem(bindings).hasFullDiskAccess()).resolves.toBe(true);
		expect(calls).toEqual([COMMANDS.fullDiskAccessCheck]);
		expect(COMMANDS.fullDiskAccessCheck).toBe("full_disk_access_check");
	});

	it("PLAT-24 passes a failed check on instead of inventing access", async () => {
		const failure = { code: "full_disk_access_check_failed", message: "The check failed." };
		const bindings = bindingsInvoking(async <T>(): Promise<T> => {
			throw failure;
		});

		await expect(createTauriSystem(bindings).hasFullDiskAccess()).rejects.toEqual(failure);
	});

	it("PLAT-24 asks the full_disk_access_open_settings command and returns Ok", async () => {
		const calls: string[] = [];
		const bindings = bindingsInvoking(async <T>(command: string): Promise<T> => {
			calls.push(command);
			return undefined as T;
		});

		const result = await createTauriSystem(bindings).openFullDiskAccessSettings();

		expect(result).toEqual({ ok: true, value: undefined });
		expect(calls).toEqual([COMMANDS.fullDiskAccessOpenSettings]);
		expect(COMMANDS.fullDiskAccessOpenSettings).toBe("full_disk_access_open_settings");
	});

	it("PLAT-24 returns a failed open command as Err", async () => {
		const failure = { code: "full_disk_access_open_failed", message: "System Settings refused." };
		const bindings = bindingsInvoking(async <T>(): Promise<T> => {
			throw failure;
		});

		const result = await createTauriSystem(bindings).openFullDiskAccessSettings();

		expect(result).toEqual({ ok: false, error: failure });
	});
});
