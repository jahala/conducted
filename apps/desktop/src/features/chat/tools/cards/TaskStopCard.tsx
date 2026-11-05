/**
 * @feature CHAT-20 Stop task card
 * Owns: The card for the agent stopping a background task it started.
 * Behaviour: ui-map.md 3.3 ('Stop task').
 * Must handle: A task that had already ended; a stop that failed.
 * Test first: A task_stop call renders 'Stop task' and the task's name.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function TaskStopCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
