/**
 * @feature AGENT-16 Chat options the settings offer: output style, personality, effort, Chrome
 * Owns: tests for the Claude half of the chat options: the effort and thinking options, the
 * settings JSON, the Chrome flag and the restart rule.
 * Test first: effort `ultra` gives the effort option `max`; effort `none` gives none and a
 * disabled thinking option.
 */
import { describe, expect, test } from "bun:test";
import type { SessionConfig } from "@conducted/protocol";
import { classifyConfigChange } from "./config-change.ts";
import {
	claudeEffortOption,
	claudeExtraArguments,
	claudeRestartNeeded,
	claudeSettingsOption,
	claudeThinkingOption,
} from "./launch-settings.ts";

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
	return {
		agent: "claude",
		model: "claude-sonnet-5",
		effort: "high",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: true, progressUpdates: true, setTargetBranch: false },
		...overrides,
	};
}

describe("AGENT-16 Claude effort and thinking options", () => {
	test("ultra is sent as max and none sends no effort", () => {
		expect(claudeEffortOption("ultra")).toBe("max");
		expect(claudeEffortOption("none")).toBeUndefined();
	});

	test("ultracode sends no effort because the settings JSON carries it", () => {
		expect(claudeEffortOption("ultracode")).toBeUndefined();
	});

	test("the other levels pass as they are", () => {
		for (const level of ["low", "medium", "high", "xhigh", "max"] as const) {
			expect(claudeEffortOption(level)).toBe(level);
		}
	});

	test("effort none disables thinking and every other level is adaptive and summarised", () => {
		expect(claudeThinkingOption("none", true)).toEqual({ type: "disabled" });
		for (const level of ["low", "medium", "high", "xhigh", "max", "ultra", "ultracode"] as const) {
			expect(claudeThinkingOption(level, true)).toEqual({
				type: "adaptive",
				display: "summarized",
			});
		}
	});

	test("a model without adaptive thinking gets Conductor's token budget for the effort", () => {
		const budgets = { low: 1024, medium: 8192, high: 16_000, xhigh: 63_999, max: 63_999 };
		for (const [level, budgetTokens] of Object.entries(budgets)) {
			expect(claudeThinkingOption(level as keyof typeof budgets, false)).toEqual({
				type: "enabled",
				budgetTokens,
				display: "summarized",
			});
		}
		// Ultra is sent as max, so it thinks with max's budget.
		expect(claudeThinkingOption("ultra", false)).toEqual({
			type: "enabled",
			budgetTokens: 63_999,
			display: "summarized",
		});
		expect(claudeThinkingOption("none", false)).toEqual({ type: "disabled" });
	});

	test("a model the catalog does not describe keeps adaptive thinking", () => {
		expect(claudeThinkingOption("high", undefined)).toEqual({
			type: "adaptive",
			display: "summarized",
		});
	});
});

describe("AGENT-16 Claude settings JSON", () => {
	test("nothing set gives no settings object", () => {
		expect(claudeSettingsOption(config())).toBeUndefined();
		expect(claudeSettingsOption(config({ claudeOutputStyle: "default" }))).toBeUndefined();
	});

	test("a non-default output style is written", () => {
		expect(claudeSettingsOption(config({ claudeOutputStyle: "concise" }))).toEqual({
			outputStyle: "concise",
		});
	});

	test("fast mode and ultracode are written only when on", () => {
		expect(claudeSettingsOption(config({ fastMode: true }))).toEqual({ fastMode: true });
		expect(claudeSettingsOption(config({ effort: "ultracode" }))).toEqual({ ultracode: true });
	});

	test("output style, fast mode and ultracode travel together", () => {
		expect(
			claudeSettingsOption(
				config({ claudeOutputStyle: "learning", fastMode: true, effort: "ultracode" }),
			),
		).toEqual({ outputStyle: "learning", fastMode: true, ultracode: true });
	});
});

describe("AGENT-16 Claude in Chrome", () => {
	test("missing or off sends no Chrome flag", () => {
		expect(claudeExtraArguments(config())).toBeUndefined();
		expect(claudeExtraArguments(config({ claudeInChrome: false }))).toBeUndefined();
	});

	test("on sends the chrome argument", () => {
		expect(claudeExtraArguments(config({ claudeInChrome: true }))).toEqual({ chrome: null });
	});
});

describe("AGENT-16 Claude restart rule", () => {
	test("an output style change restarts, and default equals missing", () => {
		expect(claudeRestartNeeded(config(), config({ claudeOutputStyle: "proactive" }))).toBe(true);
		expect(claudeRestartNeeded(config(), config({ claudeOutputStyle: "default" }))).toBe(false);
	});

	test("turning ultracode on or off restarts", () => {
		expect(claudeRestartNeeded(config(), config({ effort: "ultracode" }))).toBe(true);
		expect(claudeRestartNeeded(config({ effort: "ultracode" }), config())).toBe(true);
	});

	test("turning Chrome on or off restarts", () => {
		expect(claudeRestartNeeded(config(), config({ claudeInChrome: true }))).toBe(true);
		expect(claudeRestartNeeded(config({ claudeInChrome: true }), config())).toBe(true);
	});

	test("a change outside those options does not restart", () => {
		expect(claudeRestartNeeded(config(), config({ model: "claude-opus-5" }))).toBe(false);
		expect(claudeRestartNeeded(config(), config({ effort: "ultra" }))).toBe(false);
	});

	test("the config change classifier asks this rule", () => {
		expect(classifyConfigChange(config(), config({ claudeOutputStyle: "concise" })).kind).toBe(
			"restart",
		);
		expect(classifyConfigChange(config(), config({ claudeInChrome: true })).kind).toBe("restart");
		expect(
			classifyConfigChange(config({ effort: "ultracode" }), config({ effort: "high" })).kind,
		).toBe("restart");
	});
});
