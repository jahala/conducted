/**
 * @feature PLAT-10 Keychain read and write
 * Owns: tests for the Tauri Keychain door: the three command names, their arguments, and a
 * rejected call becoming an `AppError`.
 * Behaviour: docs/plans/tauri-commands.md, native-and-sidecar-map.md A2 and A5.
 */

import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriKeychain, type TauriBindings } from "./tauri.ts";

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

describe("PLAT-10 Tauri Keychain", () => {
	it("PLAT-10 reads a secret and keeps a missing one as null", async () => {
		const calls: Call[] = [];
		const keychain = createTauriKeychain(
			commandBindings((command, args) => {
				calls.push({ command, args });
				return args?.key === "present" ? "secret" : null;
			}),
		);

		const present = await keychain.get("present");
		const missing = await keychain.get("missing");

		expect(present).toEqual({ ok: true, value: "secret" });
		expect(missing).toEqual({ ok: true, value: null });
		expect(calls).toEqual([
			{ command: COMMANDS.keychainGet, args: { key: "present" } },
			{ command: COMMANDS.keychainGet, args: { key: "missing" } },
		]);
	});

	it("PLAT-10 stores a secret under its key", async () => {
		const calls: Call[] = [];
		const keychain = createTauriKeychain(
			commandBindings((command, args) => {
				calls.push({ command, args });
				return undefined;
			}),
		);

		const result = await keychain.set("gh_pat_token", "ghp_example");

		expect(result).toEqual({ ok: true, value: undefined });
		expect(calls).toEqual([
			{
				command: COMMANDS.keychainSet,
				args: { key: "gh_pat_token", value: "ghp_example" },
			},
		]);
	});

	it("PLAT-10 deletes a secret and turns a denial into an AppError", async () => {
		const calls: Call[] = [];
		const keychain = createTauriKeychain(
			commandBindings((command, args) => {
				calls.push({ command, args });
				if (args?.key === "denied") {
					throw { code: "keychain_denied", message: "Access was denied." };
				}
				return undefined;
			}),
		);

		const deleted = await keychain.delete("old_key");
		const denied = await keychain.delete("denied");

		expect(deleted).toEqual({ ok: true, value: undefined });
		expect(denied.ok).toBe(false);
		expect(!denied.ok && denied.error.code).toBe("keychain_denied");
		expect(calls).toEqual([
			{ command: COMMANDS.keychainDelete, args: { key: "old_key" } },
			{ command: COMMANDS.keychainDelete, args: { key: "denied" } },
		]);
	});
});
