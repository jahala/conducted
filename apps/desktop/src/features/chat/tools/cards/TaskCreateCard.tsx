/**
 * @feature CHAT-20 Task created card
 * Owns: The card for the agent creating a task in its task list.
 * Behaviour: ui-map.md 3.3 (Tasks: 'Task created').
 * Must handle: A task with no description; a task that blocks or is blocked by others.
 * Test first: A task_create call renders 'Task created' and the task subject.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function TaskCreateCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
