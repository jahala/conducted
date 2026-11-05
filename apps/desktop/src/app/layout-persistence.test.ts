import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearPanelLayout,
	loadPanelLayout,
	panelLayoutStorageKey,
	parsePanelLayout,
	savePanelLayout,
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
