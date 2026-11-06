/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: tests for the `/goal` built-in: Codex lists it, another agent does not, and choosing it
 * opens the goal bar while another agent gets the Conductor sentence.
 * Behaviour: ui-map.md 3.5 (the built-in commands and their agents).
 * Test first: `/goal` is a built-in for Codex and not for Claude.
 */
import type { SlashCommand } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import {
	builtinSlashCommands,
	GOAL_UNAVAILABLE,
	slashCommandAction,
	slashCommandProblem,
} from "./SlashCommandExtension.ts";

const goal: SlashCommand = {
	name: "goal",
	description: "Set the objective Codex should keep working toward",
	source: "builtin",
	kind: "command",
};

describe("COMP-10 /goal", () => {
	it("offers /goal to a Codex chat and not to another agent", () => {
		expect(builtinSlashCommands("codex").map((command) => command.name)).toContain("goal");
		expect(builtinSlashCommands("claude").map((command) => command.name)).not.toContain("goal");
	});

	it("opens the goal bar for Codex", () => {
		expect(slashCommandAction(goal, [], "codex")).toEqual({ kind: "goal" });
	});

	it("tells a chat that cannot do goals why /goal is unavailable", () => {
		expect(slashCommandAction(goal, [], "claude")).toEqual({
			kind: "unavailable",
			message: "Codex goals are not available in this chat.",
		});
		expect(slashCommandProblem("goal", "claude")).toBe(GOAL_UNAVAILABLE);
		expect(slashCommandProblem("goal", "codex")).toBeNull();
	});
});
