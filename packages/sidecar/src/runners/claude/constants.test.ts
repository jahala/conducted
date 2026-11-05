import { describe, expect, test } from "bun:test";
import {
	CLAUDE_DISALLOWED_TOOLS,
	CLAUDE_LAUNCH_ENV,
	CLAUDE_MAX_TURNS,
	CLAUDE_SETTING_SOURCES,
	CLAUDE_TOOL_ALIASES,
	INTERRUPT_GRACE_MS,
	SETTLEMENT_WATCHDOG_MS,
} from "./constants.ts";

describe("AGENT-02 Claude constants", () => {
	test("the built-in question tool is disallowed and aliased to our own server's tool", () => {
		expect(CLAUDE_DISALLOWED_TOOLS).toContain("AskUserQuestion");
		expect(CLAUDE_TOOL_ALIASES.AskUserQuestion).toBe("mcp__conducted__AskUserQuestion");
	});

	test("the fixed option values match the research", () => {
		expect(CLAUDE_MAX_TURNS).toBe(1000);
		expect(CLAUDE_SETTING_SOURCES).toEqual(["user", "project", "local"]);
		expect(CLAUDE_LAUNCH_ENV).toEqual({ CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" });
	});

	test("the turn guards use the researched intervals", () => {
		expect(SETTLEMENT_WATCHDOG_MS).toBe(120_000);
		expect(INTERRUPT_GRACE_MS).toBe(5_000);
	});
});
