import { expect, test } from "bun:test";
import { CLAUDE_DISALLOWED_TOOLS, CLAUDE_TOOL_ALIASES } from "./constants.ts";

test("the built-in question tool is disallowed and aliased to our own server's tool", () => {
	expect(CLAUDE_DISALLOWED_TOOLS).toContain("AskUserQuestion");
	expect(CLAUDE_TOOL_ALIASES.AskUserQuestion).toBe("mcp__conducted__AskUserQuestion");
});
