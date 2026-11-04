/**
 * @feature CHAT-20 Start monitor card
 * Owns: The card for the agent watching a command's output in the background.
 * Behaviour: ui-map.md 3.3 ('Start monitor').
 * Must handle: A monitor still running; one that ended with an error.
 * Test first: A monitor call renders 'Start monitor' and the watched command.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function MonitorCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
