import { describe, expect, test } from "bun:test";
import { canonicalToolForCursor } from "./tool-names.ts";

describe("AGENT-10 Cursor tool names", () => {
	test("Cursor's native names map to canonical tools", () => {
		expect(canonicalToolForCursor("read")).toBe("read");
		expect(canonicalToolForCursor("read_file")).toBe("read");
		expect(canonicalToolForCursor("edit")).toBe("edit");
		expect(canonicalToolForCursor("edit_file")).toBe("edit");
		expect(canonicalToolForCursor("shell")).toBe("bash");
		expect(canonicalToolForCursor("glob")).toBe("glob");
		expect(canonicalToolForCursor("list_dir")).toBe("list");
		expect(canonicalToolForCursor("createPlan")).toBe("exit_plan_mode");
		expect(canonicalToolForCursor("mystery")).toBe("unknown");
	});

	test("MCP names are split into our own server and others", () => {
		expect(canonicalToolForCursor("mcp__conducted__DiffComment")).toBe("app_tool");
		expect(canonicalToolForCursor("mcp__linear__get_issue")).toBe("mcp");
	});

	test("names are matched exactly", () => {
		expect(canonicalToolForCursor("Shell")).toBe("unknown");
		expect(canonicalToolForCursor("create_plan")).toBe("unknown");
	});
});
