/**
 * @feature PLAT-15 App menu with accelerators from the command registry
 * Owns: the Tauri door for the quit hand-shake and the web inspector toggle.
 * Behaviour: docs/plans/tauri-commands.md (`set_quit_handler_ready`, `window_toggle_inspector`).
 */

import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriAppInfo, createTauriWindow, type TauriBindings } from "./tauri.ts";

function bindings(invoke: TauriBindings["invoke"]): TauriBindings {
	return { invoke, listen: async () => () => {} };
}

describe("PLAT-15 Tauri quit hand-shake", () => {
	it("PLAT-15 tells Rust the UI listens for quit requests", async () => {
		const calls: string[] = [];
		const app = createTauriAppInfo(
			bindings(async <T>(command: string): Promise<T> => {
				calls.push(command);
				return undefined as T;
			}),
			{ version: "0.1.0", channel: "dev" },
		);

		await app.setQuitHandlerReady();
		expect(calls).toEqual([COMMANDS.setQuitHandlerReady]);
	});

	it("PLAT-15 raises the failure instead of dropping it", async () => {
		const app = createTauriAppInfo(
			bindings(async () => {
				throw { code: "io", message: "no event loop" };
			}),
			{ version: "0.1.0", channel: "dev" },
		);

		await expect(app.setQuitHandlerReady()).rejects.toEqual({
			code: "io",
			message: "no event loop",
		});
	});
});

describe("PLAT-15 Tauri web inspector", () => {
	it("PLAT-15 asks Rust to toggle the inspector", async () => {
		const calls: string[] = [];
		const window = createTauriWindow(
			bindings(async <T>(command: string): Promise<T> => {
				calls.push(command);
				return undefined as T;
			}),
		);

		await window.toggleInspector();
		expect(calls).toEqual([COMMANDS.windowToggleInspector]);
	});

	it("PLAT-15 raises the failure instead of dropping it", async () => {
		const window = createTauriWindow(
			bindings(async () => {
				throw { code: "window_missing", message: "The main window is not open." };
			}),
		);

		await expect(window.toggleInspector()).rejects.toEqual({
			code: "window_missing",
			message: "The main window is not open.",
		});
	});
});
