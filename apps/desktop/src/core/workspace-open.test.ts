import { describe, expect, it } from "vitest";
import type { Workspace } from "./model.ts";
import { canOpenWorkspace, canShowWorkspaceRoute } from "./workspace-open.ts";

/** A row with the archived time it may still carry; the rule reads only its state. */
function workspace(state: Workspace["state"], archivedAt: number | null) {
	return { state, archivedAt };
}

describe("NAV-02 canOpenWorkspace", () => {
	it("opens a ready workspace that has not been archived", () => {
		expect(canOpenWorkspace(workspace("ready", null))).toBe(true);
	});

	it("opens a workspace that is still initializing or failed", () => {
		expect(canOpenWorkspace(workspace("initializing", null))).toBe(true);
		expect(canOpenWorkspace(workspace("failed", null))).toBe(true);
	});

	it("refuses an archived workspace", () => {
		expect(canOpenWorkspace(workspace("archived", 10))).toBe(false);
	});

	it("refuses a workspace that is being archived", () => {
		expect(canOpenWorkspace(workspace("archiving", null))).toBe(false);
	});

	it("opens a workspace being restored even though its archived time is still set", () => {
		expect(canOpenWorkspace(workspace("initializing", 10))).toBe(true);
	});
});

describe("NAV-02 canShowWorkspaceRoute", () => {
	it("an archived workspace's route stays; an archiving one's does not", () => {
		expect(canShowWorkspaceRoute(workspace("archived", 10))).toBe(true);
		expect(canShowWorkspaceRoute(workspace("archiving", null))).toBe(false);
		expect(canShowWorkspaceRoute(workspace("initializing", 10))).toBe(true);
		expect(canShowWorkspaceRoute(workspace("ready", null))).toBe(true);
	});
});
