import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriAppInfo, type TauriBindings } from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

function commandBindings(
	handler: (command: string, args?: Record<string, unknown>) => unknown,
): TauriBindings {
	return {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
			handler(command, args) as T,
		listen: async () => () => {},
	};
}

describe("PLAT-14 Tauri resource usage", () => {
	it("PLAT-14 asks the Rust shell for usage and returns the rows", async () => {
		const calls: Call[] = [];
		const rows = [
			{ pid: 7, name: "sleep", cpuPercent: 1.5, memoryBytes: 1024, workspacePath: "/tmp/ws" },
			{ pid: 8, name: "sh", cpuPercent: 0, memoryBytes: 2048 },
		];
		const app = createTauriAppInfo(
			commandBindings((command, args) => {
				calls.push({ command, args });
				return rows;
			}),
			{ version: "0.1.0", channel: "dev" },
		);

		await expect(app.resourceUsage()).resolves.toEqual(rows);
		expect(calls).toEqual([{ command: COMMANDS.resourceUsage, args: { workspacePaths: [] } }]);
	});

	it("PLAT-14 throws the Rust error because the method returns no Result", async () => {
		const app = createTauriAppInfo(
			commandBindings(() => {
				throw { code: "resource_usage_failed", message: "The process table could not be read" };
			}),
			{ version: "0.1.0", channel: "dev" },
		);

		await expect(app.resourceUsage()).rejects.toMatchObject({
			code: "resource_usage_failed",
		});
	});
});
