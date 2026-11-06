import { describe, expect, it } from "vitest";
import { syncedBaselineRef } from "./stack-catch-up.ts";

describe("stack catch-up refs", () => {
	it("keeps the stack sync baseline in a per-worktree ref", () => {
		expect(syncedBaselineRef("abc")).toBe("refs/worktree/conducted/synced/abc");
	});
});
