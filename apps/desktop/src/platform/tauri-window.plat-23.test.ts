// @vitest-environment node
/**
 * @feature PLAT-23 Window look: vibrancy, traffic lights and zoom
 * Owns: tests for the Platform's window look setters: the webview zoom, the window theme, the
 * sidebar vibrancy command and the traffic-light command, plus the capability that lets the
 * webview zoom run.
 * Behaviour: docs/plans/tauri-commands.md (`window.setZoom` and `window.setTheme` use the Tauri
 * window and webview APIs, `window.setVibrancy` calls `window_set_vibrancy`, and
 * `window.setTrafficLightPosition` calls `window_set_traffic_lights`), native-and-sidecar-map.md A3.
 * Test first: setVibrancy(true) sends `window_set_vibrancy` with `{ enabled: true }`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriWindow, type TauriBindings } from "./tauri.ts";

interface Calls {
	commands: { command: string; args?: Record<string, unknown> }[];
	zoom: number[];
	themes: ("light" | "dark" | null)[];
}

function fakeBindings(): { bindings: TauriBindings; calls: Calls } {
	const calls: Calls = { commands: [], zoom: [], themes: [] };
	return {
		calls,
		bindings: {
			invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
				calls.commands.push({ command, args });
				return undefined as T;
			},
			listen: async () => () => {},
			window: {
				isFocused: async () => true,
				listen: async () => () => {},
				onDragDropEvent: async () => () => {},
				setTheme: async (theme) => {
					calls.themes.push(theme);
				},
			},
			webview: {
				setZoom: async (factor) => {
					calls.zoom.push(factor);
				},
			},
		},
	};
}

describe("PLAT-23 Tauri window look", () => {
	it("zooms the webview to the given factor", async () => {
		const { bindings, calls } = fakeBindings();
		const window = createTauriWindow(bindings);

		expect(await window.setZoom(1.25)).toEqual({ ok: true, value: undefined });
		expect(calls.zoom).toEqual([1.25]);
	});

	it("reports a zoom that the webview refuses as an AppError", async () => {
		const { bindings } = fakeBindings();
		const window = createTauriWindow({
			...bindings,
			webview: {
				setZoom: async () => {
					throw { code: "zoom_refused", message: "The webview refused the zoom." };
				},
			},
		});

		expect(await window.setZoom(2)).toEqual({
			ok: false,
			error: { code: "zoom_refused", message: "The webview refused the zoom." },
		});
	});

	it("sets the window theme, and null follows macOS", async () => {
		const { bindings, calls } = fakeBindings();
		const window = createTauriWindow(bindings);

		await window.setTheme("dark");
		await window.setTheme(null);

		expect(calls.themes).toEqual(["dark", null]);
	});

	it("raises a theme the window refuses instead of dropping it", async () => {
		const { bindings } = fakeBindings();
		const window = createTauriWindow({
			...bindings,
			window: {
				isFocused: async () => true,
				listen: async () => () => {},
				onDragDropEvent: async () => () => {},
				setTheme: async () => {
					throw { code: "theme_refused", message: "The window refused the theme." };
				},
			},
		});

		await expect(window.setTheme("light")).rejects.toEqual({
			code: "theme_refused",
			message: "The window refused the theme.",
		});
	});

	it("sends the vibrancy flag to its Rust command", async () => {
		const { bindings, calls } = fakeBindings();
		const window = createTauriWindow(bindings);

		expect(await window.setVibrancy(true)).toEqual({ ok: true, value: undefined });
		expect(calls.commands).toEqual([
			{ command: COMMANDS.windowSetVibrancy, args: { enabled: true } },
		]);
	});

	it("sends the traffic-light inset to its Rust command", async () => {
		const { bindings, calls } = fakeBindings();
		const window = createTauriWindow(bindings);

		expect(await window.setTrafficLightPosition(13, 13)).toEqual({ ok: true, value: undefined });
		expect(calls.commands).toEqual([
			{ command: COMMANDS.windowSetTrafficLights, args: { x: 13, y: 13 } },
		]);
	});
});

describe("PLAT-23 window capability and configuration", () => {
	it("allows the webview zoom and the window theme the UI calls", () => {
		const capability = JSON.parse(
			readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8"),
		) as { permissions: unknown[] };

		expect(capability.permissions).toContain("core:webview:allow-set-webview-zoom");
		expect(capability.permissions).toContain("core:window:allow-set-theme");
	});

	it("starts the main window transparent with room for the traffic lights", () => {
		const config = JSON.parse(
			readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
		) as {
			app: {
				windows: {
					label: string;
					transparent: boolean;
					trafficLightPosition: { x: number; y: number };
				}[];
			};
		};
		const main = config.app.windows.find((window) => window.label === "main");

		expect(main?.transparent).toBe(true);
		expect(main?.trafficLightPosition).toEqual({ x: 13, y: 13 });
	});
});
