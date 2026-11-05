/**
 * @feature CHAT-09 Todo block
 * Owns: A todo list the agent emitted as its own block in the turn.
 * Behaviour: ui-map.md 3.3 (Todo), frontend.md 5 (todo lists use the 'todo' kind).
 * Must handle: A list with no items ('No todos'); the block names how many are done.
 * Test first: A block with 3 items and 1 done reads '1 of 3 done' and lists the three items.
 */

import type { AgentItem } from "@conducted/protocol";
import { ListTodoIcon } from "../../ui/icons.tsx";
import { TodoList } from "./TodoList.tsx";

export interface TodoBlockProps {
	item: Extract<AgentItem, { kind: "todo" }>;
}

export function TodoBlock({ item }: TodoBlockProps) {
	const total = item.items.length;
	const done = item.items.filter((entry) => entry.status === "done").length;
	return (
		<div className="rounded-lg border border-border bg-surface">
			<div className="flex h-9 items-center gap-2 px-3">
				<span className="flex size-4 items-center justify-center text-fg-subtle">
					<ListTodoIcon />
				</span>
				<span className="text-sm font-medium text-fg">Todo</span>
				{total === 0 ? null : (
					<span className="text-xs text-fg-muted">{`${done} of ${total} done`}</span>
				)}
			</div>
			<div className="border-t border-border p-3">
				<TodoList items={item.items} />
			</div>
		</div>
	);
}
