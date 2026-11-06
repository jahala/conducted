/**
 * @feature AGENT-14 Codex `/compact`
 * Owns: the test that choosing /compact in a Codex chat runs the app's compact action instead of
 * sending the text to the agent.
 * Behaviour: ui-map.md 3.5 and other-runners.md 2.1.
 * Test first: /compact for Codex returns the compact action.
 */
import { describe, expect, it } from "vitest";
import { builtinSlashCommands, slashCommandAction } from "./SlashCommandExtension.ts";

const compact = builtinSlashCommands("codex").find((command) => command.name === "compact");

describe("AGENT-14 /compact slash command", () => {
	it("runs Codex's compact call instead of sending the text", () => {
		if (compact === undefined) throw new Error("Codex does not offer /compact");
		expect(slashCommandAction(compact, [], "codex")).toEqual({ kind: "compact" });
	});

	it("leaves Claude on its own /compact command", () => {
		const claude = builtinSlashCommands("claude").find((command) => command.name === "compact");
		if (claude === undefined) throw new Error("Claude does not offer /compact");
		expect(slashCommandAction(claude, [claude], "claude")).toEqual({
			kind: "send",
			text: "/compact",
		});
	});
});
