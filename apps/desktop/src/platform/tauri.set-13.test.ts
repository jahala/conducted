/**
 * @feature SET-13 Chosen program paths reach terminals and scripts
 * Owns: the Tauri adapter's call to `programs_sync_path_overrides`.
 * Test first: the chosen paths are sent as the `overrides` argument and the returned folder is Ok.
 */
import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriPrograms, type TauriBindings } from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

function bindings(
	handler: (command: string, args?: Record<string, unknown>) => unknown,
): TauriBindings {
	return {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
			handler(command, args) as T,
		listen: async () => () => {},
	};
}

describe("SET-13 Tauri path overrides", () => {
	it("sends the chosen program paths and returns the shim folder", async () => {
		const calls: Call[] = [];
		const programs = createTauriPrograms(
			bindings((command, args) => {
				calls.push({ command, args });
				return "/data/bin-overrides/abc";
			}),
		);

		const result = await programs.syncPathOverrides({ claude: "/opt/claude" });

		expect(result).toEqual({ ok: true, value: "/data/bin-overrides/abc" });
		expect(calls).toEqual([
			{
				command: COMMANDS.programsSyncPathOverrides,
				args: { overrides: { claude: "/opt/claude" } },
			},
		]);
	});

	it("returns an error instead of throwing when the command fails", async () => {
		const programs = createTauriPrograms(
			bindings(() => {
				throw { code: "path_override_invalid", message: "The path cannot be used." };
			}),
		);

		const result = await programs.syncPathOverrides({ codex: "/opt/codex" });

		expect(result).toEqual({
			ok: false,
			error: { code: "path_override_invalid", message: "The path cannot be used." },
		});
	});
});
