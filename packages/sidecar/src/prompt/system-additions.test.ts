import { describe, expect, test } from "bun:test";
import {
	buildClaudeSystemPrompt,
	CLAUDE_SYSTEM_PROMPT_PRESET,
	progressTrackerGuidance,
} from "./system-additions.ts";

describe("SIDE-09 system prompt additions", () => {
	test("the guidance names the tool as the agent sees it", () => {
		expect(progressTrackerGuidance("mcp__conducted__UpdateProgress")).toContain(
			"mcp__conducted__UpdateProgress",
		);
	});

	test("the Claude prompt is the stock preset, without the tracker when the switch is off", () => {
		const prompt = buildClaudeSystemPrompt(false, "mcp__conducted__UpdateProgress");
		expect(prompt).toEqual({ type: "preset", preset: CLAUDE_SYSTEM_PROMPT_PRESET });
	});

	test("the tracker paragraph is appended only when the progress switch is on", () => {
		const prompt = buildClaudeSystemPrompt(true, "mcp__conducted__UpdateProgress");
		expect(prompt.preset).toBe(CLAUDE_SYSTEM_PROMPT_PRESET);
		expect(prompt.append).toContain("mcp__conducted__UpdateProgress");
	});
});
