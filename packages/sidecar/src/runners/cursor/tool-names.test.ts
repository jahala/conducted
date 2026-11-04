import { expect, test } from "bun:test";
import { canonicalToolForCursor } from "./tool-names.ts";

test("Cursor's native names map to canonical tools", () => {
	expect(canonicalToolForCursor("shell")).toBe("bash");
	expect(canonicalToolForCursor("read_file")).toBe("read");
	expect(canonicalToolForCursor("list_dir")).toBe("list");
	expect(canonicalToolForCursor("createPlan")).toBe("exit_plan_mode");
	expect(canonicalToolForCursor("mystery")).toBe("unknown");
});

test("MCP names are split into our own server and others", () => {
	expect(canonicalToolForCursor("mcp__conducted__DiffComment")).toBe("app_tool");
	expect(canonicalToolForCursor("mcp__linear__get_issue")).toBe("mcp");
});
