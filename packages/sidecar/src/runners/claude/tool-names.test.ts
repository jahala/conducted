import { describe, expect, test } from "bun:test";
import { BUILTIN_TOOL_NAMES } from "@anthropic-ai/claude-agent-sdk";
import { canonicalToolFor, isNonWritingTool } from "./tool-names.ts";

describe("AGENT-03 Claude tool names", () => {
	test("app tools and other MCP tools are told apart", () => {
		expect(canonicalToolFor("mcp__conducted__GetWorkspaceDiff")).toBe("app_tool");
		expect(canonicalToolFor("mcp__linear__get_issue")).toBe("mcp");
		expect(canonicalToolFor("SomethingNew")).toBe("unknown");
	});

	test("the old name Task maps like Agent", () => {
		expect(canonicalToolFor("Task")).toBe("sub_agent");
		expect(canonicalToolFor("Agent")).toBe("sub_agent");
	});

	test("task and monitor tools map to their own canonical tools", () => {
		expect(canonicalToolFor("TaskCreate")).toBe("task_create");
		expect(canonicalToolFor("TaskGet")).toBe("task_get");
		expect(canonicalToolFor("TaskList")).toBe("task_list");
		expect(canonicalToolFor("TaskUpdate")).toBe("task_update");
		expect(canonicalToolFor("TaskStop")).toBe("task_stop");
		expect(canonicalToolFor("Monitor")).toBe("monitor");
		expect(canonicalToolFor("ScheduleWakeup")).toBe("schedule_wakeup");
		expect(canonicalToolFor("SendMessage")).toBe("send_message");
		expect(canonicalToolFor("ToolSearch")).toBe("tool_search");
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
			"TaskCreate",
			"TaskGet",
			"TaskList",
			"TaskUpdate",
			"TaskStop",
			"Monitor",
			"ScheduleWakeup",
			"SendMessage",
			"ToolSearch",
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
			"TaskOutput",
			"CronList",
			"mcp__conducted__UpdateProgress",
		]) {
			expect(isNonWritingTool(name)).toBe(true);
		}
		for (const name of ["Edit", "Write", "Bash", "NotebookEdit", "mcp__linear__create_issue"]) {
			expect(isNonWritingTool(name)).toBe(false);
		}
	});
});
