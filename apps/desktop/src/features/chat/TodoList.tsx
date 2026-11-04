/**
 * @feature CHAT-09 Todo list
 * Owns: The checklist drawing shared by the todo block and the todo tool card.
 * Behaviour: ui-map.md 3.3 (Todo: 'No todos', 'Todo started', 'Todo completed'), frontend.md 5
 * (todo kind).
 * Our design choice: Status is shown by a shape and a word in assistive text, not by colour alone.
 * Done items are struck through.
 * Must handle: No items ('No todos'); one item in progress (marked, announced as in progress); a
 * long label wraps; items reorder when the agent rewrites the list without remounting.
 * Test first: Three items with statuses pending, in_progress and done render three rows with
 * distinct accessible states.
 */

import type { AgentItem } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

export type TodoItems = Extract<AgentItem, { kind: "todo" }>["items"];

export interface TodoListProps {
	items: TodoItems;
}

export function TodoList(_props: TodoListProps): never {
	return notImplemented("CHAT-09");
}
