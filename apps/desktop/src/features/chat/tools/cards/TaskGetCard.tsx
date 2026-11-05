/**
 * @feature CHAT-20 Task details card
 * Owns: The card for the agent reading one task.
 * Behaviour: ui-map.md 3.3 (Tasks: 'Task details' with Status, Subject, Blocked by, Blocks).
 * Must handle: A task that no longer exists; empty Blocked by and Blocks lists.
 * Test first: A task_get result renders 'Task details' with its status and subject.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function TaskGetCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
