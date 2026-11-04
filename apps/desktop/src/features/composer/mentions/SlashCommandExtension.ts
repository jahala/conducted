/**
 * @feature COMP-06 / slash commands
 * Owns: The '/' trigger: built-in commands, project commands and skills, and what choosing one
 * does.
 * Behaviour: ui-map.md 3.5 (built-in slash commands /clear /restart /add-dir /compact /plan /fast
 * and others, per agent; terminal-effect commands show a bar 'Run /x in the embedded terminal'),
 * claude-runner.md 7 (slash command listing).
 * Our design choice: The command list comes from the sidecar (`useSlashCommands`), filtered by the
 * chat's agent. Only a '/' at the start of the message opens the popup.
 * Must handle: A command that is not supported by the current agent (hidden); a command with an
 * argument hint (shown after the name); a terminal-effect command (opens TerminalCommandBar); list
 * not loaded yet (loading row); /clear closes the tab and starts a fresh chat.
 * Test first: Typing '/co' lists '/compact' for Claude and not for an agent that lacks it.
 */

import type { SlashCommand } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { Node } from "@tiptap/react";

export interface SlashCommandDeps {
	commands: SlashCommand[];
	onRun: (command: SlashCommand, args: string) => void;
}

export function createSlashCommands(_props: SlashCommandDeps): Node {
	return notImplemented("COMP-06");
}
