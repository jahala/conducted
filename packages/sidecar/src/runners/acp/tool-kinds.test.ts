import { describe, expect, test } from "bun:test";
import { canonicalToolForAcp } from "./tool-kinds.ts";

describe("AGENT-12 ACP tool kinds", () => {
	test("the kind decides, and a name hint wins over it", () => {
		expect(canonicalToolForAcp({ kind: "execute" }, {})).toBe("bash");
		expect(canonicalToolForAcp({ kind: "search", name: "find" }, { find: "glob" })).toBe("glob");
		expect(canonicalToolForAcp({}, {})).toBe("unknown");
		expect(canonicalToolForAcp({ kind: "think" }, {})).toBe("unknown");
	});

	test("every ACP tool kind maps to a canonical tool", () => {
		expect(canonicalToolForAcp({ kind: "read" }, {})).toBe("read");
		expect(canonicalToolForAcp({ kind: "edit" }, {})).toBe("edit");
		expect(canonicalToolForAcp({ kind: "delete" }, {})).toBe("edit");
		expect(canonicalToolForAcp({ kind: "move" }, {})).toBe("edit");
		expect(canonicalToolForAcp({ kind: "search" }, {})).toBe("grep");
		expect(canonicalToolForAcp({ kind: "fetch" }, {})).toBe("web_fetch");
		expect(canonicalToolForAcp({ kind: "switch_mode" }, {})).toBe("unknown");
		expect(canonicalToolForAcp({ kind: "other" }, {})).toBe("unknown");
	});

	test("MCP tools are told apart", () => {
		expect(canonicalToolForAcp({ name: "mcp__conducted__GetWorkspaceDiff" }, {})).toBe("app_tool");
		expect(canonicalToolForAcp({ name: "mcp__linear__get_issue" }, {})).toBe("mcp");
	});
});
