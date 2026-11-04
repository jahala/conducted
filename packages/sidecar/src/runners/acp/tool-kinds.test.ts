import { expect, test } from "bun:test";
import { canonicalToolForAcp } from "./tool-kinds.ts";

test("the kind decides, and a name hint wins over it", () => {
	expect(canonicalToolForAcp({ kind: "execute" }, {})).toBe("bash");
	expect(canonicalToolForAcp({ kind: "search", name: "find" }, { find: "glob" })).toBe("glob");
	expect(canonicalToolForAcp({}, {})).toBe("unknown");
	expect(canonicalToolForAcp({ kind: "think" }, {})).toBe("unknown");
});

test("MCP tools are told apart", () => {
	expect(canonicalToolForAcp({ name: "mcp__conducted__GetWorkspaceDiff" }, {})).toBe("app_tool");
	expect(canonicalToolForAcp({ name: "mcp__linear__get_issue" }, {})).toBe("mcp");
});
