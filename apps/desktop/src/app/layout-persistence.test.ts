import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearPanelLayout,
	loadPanelLayout,
	type PanelLayoutSettings,
	panelLayoutStorageKey,
	parsePanelLayout,
	savePanelLayout,
	saveShellSidebar,
	shellSidebarWidth,
} from "./layout-persistence.ts";

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("NAV-01 persisted panel sizes", () => {
	it("saving then loading a layout for app-shell returns the same sizes", () => {
		const layout = { sidebar: 30, "main-content": 70 };
		savePanelLayout("app-shell", layout);
		expect(loadPanelLayout("app-shell")).toEqual(layout);
	});

	it("keeps the layout of each group apart", () => {
		savePanelLayout("workspace-right-panels-w1", { "git-panel": 60, "scripts-panel": 40 });
		savePanelLayout("workspace-right-panels-w2", { "git-panel": 25, "scripts-panel": 75 });

		expect(loadPanelLayout("workspace-right-panels-w1")).toEqual({
			"git-panel": 60,
			"scripts-panel": 40,
		});
		expect(loadPanelLayout("workspace-right-panels-w2")).toEqual({
			"git-panel": 25,
			"scripts-panel": 75,
		});
	});

	it("ignores a layout that fails to parse", () => {
		window.localStorage.setItem(panelLayoutStorageKey("app-shell"), "{not json");
		expect(loadPanelLayout("app-shell")).toBeNull();
	});

	it("ignores a saved layout for panels that no longer exist", () => {
		savePanelLayout("app-shell", { sidebar: 30, "main-content": 70 });

		expect(loadPanelLayout("app-shell", ["sidebar"])).toEqual({ sidebar: 30 });
		expect(loadPanelLayout("app-shell", ["removed-panel"])).toBeNull();
	});

	it("drops sizes that are not percentages", () => {
		window.localStorage.setItem(
			panelLayoutStorageKey("app-shell"),
			JSON.stringify({ sidebar: "wide", "main-content": 70, stale: -1, huge: 120 }),
		);

		expect(loadPanelLayout("app-shell")).toEqual({ "main-content": 70 });
	});

	it("keeps a collapsed panel at zero", () => {
		savePanelLayout("app-shell", { sidebar: 0, "main-content": 100 });
		expect(loadPanelLayout("app-shell")).toEqual({ sidebar: 0, "main-content": 100 });
	});

	it("removes a group's layout when its workspace goes away", () => {
		savePanelLayout("workspace-right-panels-w1", { "git-panel": 50, "scripts-panel": 50 });
		clearPanelLayout("workspace-right-panels-w1");
		expect(loadPanelLayout("workspace-right-panels-w1")).toBeNull();
	});

	it("reads only the sizes the library understands", () => {
		expect(parsePanelLayout({ a: 40, b: 0, c: 100 })).toEqual({ a: 40, b: 0, c: 100 });
		expect(parsePanelLayout({ a: 40, b: 101 })).toEqual({ a: 40 });
		expect(parsePanelLayout([])).toBeNull();
		expect(parsePanelLayout(null)).toBeNull();
		expect(parsePanelLayout({})).toBeNull();
	});
});

/** A settings service stand-in: sync reads and recorded writes. */
function fakeSettings(values: Record<string, unknown> = {}): PanelLayoutSettings & {
	writes: { key: string; value: unknown }[];
} {
	const writes: { key: string; value: unknown }[] = [];
	return {
		writes,
		get<T>(key: string): T {
			return values[key] as T;
		},
		async set(key: string, value: unknown) {
			writes.push({ key, value });
			values[key] = value;
		},
	};
}

describe("NAV-01 shell sidebar settings", () => {
	it("saves the sidebar width in pixels, not percentages", async () => {
		const settings = fakeSettings({ left_panel_visible: true, left_panel_width: 256 });

		saveShellSidebar(settings, { inPixels: 318.6 });
		await Promise.resolve();

		expect(settings.writes).toEqual([{ key: "left_panel_width", value: 319 }]);
	});

	it("saves the collapsed state and keeps the last width", async () => {
		const settings = fakeSettings({ left_panel_visible: true, left_panel_width: 300 });

		saveShellSidebar(settings, { inPixels: 0 });
		await Promise.resolve();

		expect(settings.writes).toEqual([{ key: "left_panel_visible", value: false }]);
		expect(settings.get<number>("left_panel_width")).toBe(300);
	});

	it("writes nothing when a mount reports the stored values again", async () => {
		const settings = fakeSettings({ left_panel_visible: true, left_panel_width: 256 });

		saveShellSidebar(settings, { inPixels: 256 });
		await Promise.resolve();

		expect(settings.writes).toEqual([]);
	});

	it("clamps a stored or measured width to the sidebar's range", () => {
		expect(shellSidebarWidth(fakeSettings({ left_panel_width: 100 }))).toBe(192);
		expect(shellSidebarWidth(fakeSettings({ left_panel_width: 900 }))).toBe(480);
		expect(shellSidebarWidth(fakeSettings({ left_panel_width: "wide" }))).toBe(256);
		expect(shellSidebarWidth(fakeSettings({}))).toBe(256);

		const settings = fakeSettings({ left_panel_visible: true, left_panel_width: 256 });
		saveShellSidebar(settings, { inPixels: 900 });
		expect(settings.writes).toEqual([{ key: "left_panel_width", value: 480 }]);
	});
});
