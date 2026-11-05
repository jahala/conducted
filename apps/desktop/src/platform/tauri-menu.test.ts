/**
 * @feature PLAT-15 App menu with accelerators from the command registry
 * Owns: the Tauri door for the quit hand-shake, the web inspector toggle, and the menu shortcut
 * and command events (PLAT-33).
 * Behaviour: docs/plans/tauri-commands.md (`set_quit_handler_ready`, `window_toggle_inspector`,
 * `menu_set_shortcuts` and the `menu://command` event).
 */

import { describe, expect, it } from "vitest";
import {
	COMMANDS,
	createTauriAppInfo,
	createTauriMenu,
	createTauriWindow,
	EVENTS,
	type TauriBindings,
} from "./tauri.ts";

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

describe("PLAT-33 Tauri menu shortcuts and commands", () => {
	it("PLAT-33 sends every accelerator to menu_set_shortcuts and returns its report", async () => {
		const calls: { command: string; args?: Record<string, unknown> }[] = [];
		const menu = createTauriMenu({
			invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
				calls.push({ command, args });
				return { applied: ["view.toggleLeftSidebar"], rejected: ["view.toggleRightSidebar"] } as T;
			},
			listen: async () => () => {},
		});
		const shortcuts = [
			{ commandId: "view.toggleLeftSidebar", accelerator: "CmdOrCtrl+B" },
			{ commandId: "view.toggleRightSidebar", accelerator: "NotAKey" },
		];

		const result = await menu.setShortcuts(shortcuts);

		expect(result).toEqual({
			ok: true,
			value: { applied: ["view.toggleLeftSidebar"], rejected: ["view.toggleRightSidebar"] },
		});
		expect(calls).toEqual([{ command: COMMANDS.menuSetShortcuts, args: { shortcuts } }]);
	});

	it("PLAT-33 returns a rejected command as an Err instead of throwing", async () => {
		const menu = createTauriMenu({
			invoke: async () => {
				throw { code: "menu_missing", message: "The app menu is not built." };
			},
			listen: async () => () => {},
		});

		const result = await menu.setShortcuts([]);

		expect(result).toEqual({
			ok: false,
			error: { code: "menu_missing", message: "The app menu is not built." },
		});
	});

	it("PLAT-33 onCommand listens to menu://command and unsubscribes", async () => {
		const handlers = new Map<string, Set<(payload: unknown) => void>>();
		const menu = createTauriMenu({
			invoke: async <T>() => undefined as T,
			listen: async <T>(event: string, handler: (payload: T) => void) => {
				let set = handlers.get(event);
				if (set === undefined) {
					set = new Set();
					handlers.set(event, set);
				}
				const wrapped = (payload: unknown) => handler(payload as T);
				set.add(wrapped);
				return () => set.delete(wrapped);
			},
		});
		const seen: string[] = [];

		const stop = menu.onCommand((commandId) => seen.push(commandId));
		await Promise.resolve();
		for (const handler of handlers.get(EVENTS.menuCommand) ?? []) handler("app.openSettings");
		stop();
		for (const handler of handlers.get(EVENTS.menuCommand) ?? []) handler("app.quit");

		expect(seen).toEqual(["app.openSettings"]);
		expect(handlers.get(EVENTS.menuCommand)?.size).toBe(0);
	});
});
