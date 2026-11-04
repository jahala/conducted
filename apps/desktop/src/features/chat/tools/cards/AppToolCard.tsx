/**
 * @feature CHAT-08 App tool card
 * Owns: The card for this app's own tools that the agent calls: workspace diff, diff comments,
 * terminal output, progress updates, target branch.
 * Behaviour: ui-map.md 3.3 (Conductor MCP cards: 'Workspace diff', 'Review comments', 'Code review
 * comments', 'Get terminal output' with source and line count, 'User input'), claude-runner.md 4.2.
 * Must handle: Which app tool it is comes from the raw name (APP_TOOLS in the protocol); an app
 * tool name the card does not know falls back to the generic look; GetTerminalOutput shows the
 * source and line count; UpdateProgress shows nothing here, the progress line above the composer
 * shows it.
 * Test first: A GetTerminalOutput call renders the terminal's name and the number of lines
 * returned.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function AppToolCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
