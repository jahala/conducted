import { describe, expect, it } from "vitest";
import { canOpenWorkspace } from "./workspace-open.ts";

describe("NAV-02 canOpenWorkspace", () => {
	it("opens a ready workspace that has not been archived", () => {
		expect(canOpenWorkspace({ state: "ready", archivedAt: null })).toBe(true);
	});

	it("opens a workspace that is still initializing or failed", () => {
		expect(canOpenWorkspace({ state: "initializing", archivedAt: null })).toBe(true);
		expect(canOpenWorkspace({ state: "failed", archivedAt: null })).toBe(true);
	});

	it("refuses an archived workspace", () => {
		expect(canOpenWorkspace({ state: "archived", archivedAt: 10 })).toBe(false);
	});

	it("refuses a workspace that is being archived", () => {
		expect(canOpenWorkspace({ state: "archiving", archivedAt: null })).toBe(false);
	});

	it("refuses a ready workspace that already carries an archived date", () => {
		expect(canOpenWorkspace({ state: "ready", archivedAt: 10 })).toBe(false);
	});
});
