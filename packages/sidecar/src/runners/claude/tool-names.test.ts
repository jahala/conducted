import { expect, test } from "bun:test";
import { BUILTIN_TOOL_NAMES } from "@anthropic-ai/claude-agent-sdk";
import { canonicalToolFor, isNonWritingTool } from "./tool-names.ts";

test("app tools and other MCP tools are told apart", () => {
	expect(canonicalToolFor("mcp__conducted__GetWorkspaceDiff")).toBe("app_tool");
	expect(canonicalToolFor("mcp__linear__get_issue")).toBe("mcp");
	expect(canonicalToolFor("SomethingNew")).toBe("unknown");
});

test("the old name Task maps like Agent", () => {
	expect(canonicalToolFor("Task")).toBe("sub_agent");
	expect(canonicalToolFor("Agent")).toBe("sub_agent");
});

test("the names we map from the installed SDK's built-in list really exist there", () => {
	for (const name of [
		"Read",
		"Write",
		"Edit",
		"NotebookEdit",
		"Bash",
		"Glob",
		"Grep",
		"WebFetch",
		"WebSearch",
		"TodoWrite",
		"AskUserQuestion",
		"EnterPlanMode",
		"ExitPlanMode",
		"Skill",
		"Agent",
	]) {
		expect(BUILTIN_TOOL_NAMES as readonly string[]).toContain(name);
		expect(canonicalToolFor(name)).not.toBe("unknown");
	}
});

test("reads and app tools do not wait for the checkpoint, writes and shell do", () => {
	for (const name of [
		"Read",
		"Glob",
		"Grep",
		"WebFetch",
		"LSP",
		"EnterPlanMode",
		"mcp__conducted__UpdateProgress",
	]) {
		expect(isNonWritingTool(name)).toBe(true);
	}
	for (const name of ["Edit", "Write", "Bash", "NotebookEdit", "mcp__linear__create_issue"]) {
		expect(isNonWritingTool(name)).toBe(false);
	}
});
