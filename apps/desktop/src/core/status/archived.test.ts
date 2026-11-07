import { describe, expect, it } from "vitest";
import { isArchivedWorkspace } from "./archived.ts";

describe("WS-06 the one archived rule", () => {
	it("counts a workspace whose state is archived", () => {
		expect(isArchivedWorkspace({ state: "archived" })).toBe(true);
	});

	it("a workspace being restored is not archived", () => {
		expect(isArchivedWorkspace({ state: "initializing" })).toBe(false);
		expect(isArchivedWorkspace({ state: "ready" })).toBe(false);
		expect(isArchivedWorkspace({ state: "failed" })).toBe(false);
		expect(isArchivedWorkspace({ state: "archiving" })).toBe(false);
	});
});
