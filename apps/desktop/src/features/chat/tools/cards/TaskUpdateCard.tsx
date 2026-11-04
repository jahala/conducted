/**
 * @feature CHAT-20 Task update card
 * Owns: The card for the agent changing a task's status, subject or links.
 * Behaviour: ui-map.md 3.3 (Tasks: 'Task details').
 * Must handle: A change of status only; a change that adds a blocker.
 * Test first: A task_update call that marks a task done shows its subject and the new status.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function TaskUpdateCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
