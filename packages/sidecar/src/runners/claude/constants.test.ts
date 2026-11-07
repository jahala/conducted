import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { APP_TOOLS } from "@conducted/protocol";
import { enabledTools } from "../../tools/registry.ts";
import {
	APP_TOOL_NAME_PREFIX,
	CLAUDE_DISALLOWED_TOOLS,
	CLAUDE_LAUNCH_ENV,
	CLAUDE_MAX_TURNS,
	CLAUDE_SETTING_SOURCES,
	CLAUDE_TOOL_ALIASES,
	INTERRUPT_GRACE_MS,
	SETTLEMENT_WATCHDOG_MS,
} from "./constants.ts";
import { SteerReceipts } from "./steer-receipts.ts";
import { ClaudeTurnTracker } from "./turn-tracker.ts";

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

describe("AGENT-02 Claude constants in use", () => {
	test("the alias that replaces the built-in question tool names a tool the app-tools server really serves", () => {
		const everything = {
			diffComments: true,
			progressUpdates: true,
			setTargetBranch: true,
			localExecution: true,
		};
		const served = enabledTools(everything, { includeAskUserQuestion: true }).map(
			(tool) => `${APP_TOOL_NAME_PREFIX}${tool.name}`,
		);

		expect(served).toHaveLength(APP_TOOLS.length);
		expect(served).toContain(CLAUDE_TOOL_ALIASES.AskUserQuestion as string);
		expect(CLAUDE_DISALLOWED_TOOLS).toContain("AskUserQuestion");
	});

	test("the turn tracker arms its settlement watchdog for exactly SETTLEMENT_WATCHDOG_MS", () => {
		const delays: number[] = [];
		const tracker = new ClaudeTurnTracker({
			receipts: new SteerReceipts(),
			scheduler: {
				after(ms) {
					delays.push(ms);
					return () => {};
				},
			},
			onSettle: () => {},
		});
		tracker.expectTurn("ours");

		tracker.onSdkMessage({
			type: "result",
			subtype: "success",
			is_error: false,
			user_message_uuid: "somebody-else",
			uuid: "result-uuid",
			session_id: "s1",
		} as unknown as SDKMessage);

		expect(delays).toEqual([SETTLEMENT_WATCHDOG_MS]);
		expect(delays).toEqual([120_000]);
	});
});
