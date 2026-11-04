import { expect, test } from "bun:test";
import { progressTrackerGuidance } from "./system-additions.ts";

test("the guidance names the tool as the agent sees it", () => {
	expect(progressTrackerGuidance("mcp__conducted__UpdateProgress")).toContain(
		"mcp__conducted__UpdateProgress",
	);
});
