/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: the /add-dir slash command's effect.
 * Behaviour: ui-map.md 3.5 ("/add-dir: Link a directory or workspace"); 3.10.
 * Test first: choosing /add-dir asks the composer to open the Link workspaces dialog.
 */
import type { SlashCommand } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import { builtinSlashCommands, slashCommandAction } from "./SlashCommandExtension.ts";

const command = (over: Partial<SlashCommand> = {}): SlashCommand => ({
	name: "add-dir",
	description: "Link a directory or workspace",
	source: "builtin",
	kind: "command",
	...over,
});

describe("WS-07 /add-dir", () => {
	it("is offered to Claude and Codex", () => {
		expect(builtinSlashCommands("claude").map((entry) => entry.name)).toContain("add-dir");
		expect(builtinSlashCommands("codex").map((entry) => entry.name)).toContain("add-dir");
	});

	it("opens the link dialog instead of sending text the agent cannot link", () => {
		expect(slashCommandAction(command(), [command()], "claude")).toEqual({
			kind: "linkDirectories",
		});
	});
});
