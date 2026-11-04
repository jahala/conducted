/**
 * @feature CHAT-08 Bash output card
 * Owns: The card for reading the output of a command that runs in the background.
 * Behaviour: frontend.md 5 (registry key 'bash-output'), claude-runner.md 4.
 * Must handle: The command is still running (the output so far); the shell id is unknown (error
 * text from the agent); no new output since the last read.
 * Test first: A bash_output call shows the new output lines.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function BashOutputCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
