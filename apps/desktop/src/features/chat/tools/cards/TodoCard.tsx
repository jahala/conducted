/**
 * @feature CHAT-09 Todo tool card
 * Owns: The card for the agent's todo tool call, drawn with the shared TodoList.
 * Behaviour: ui-map.md 3.3 (Todo: 'No todos', 'Todo started', 'Todo completed'; Tasks: 'Task
 * created', 'Task details').
 * Must handle: An empty list ('No todos'); a call that only reads the list; input that does not
 * parse as a list (generic fallback text).
 * Test first: A todo call with two items renders two rows through TodoList.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function TodoCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-09");
}
