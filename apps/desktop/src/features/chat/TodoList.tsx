/**
 * @feature CHAT-09 Todo list
 * Owns: The checklist drawing shared by the todo block and the todo tool card.
 * Behaviour: ui-map.md 3.3 (Todo: 'No todos', 'Todo started', 'Todo completed'), frontend.md 5
 * (todo kind).
 * Our design choice: Status is shown by a shape and a word in assistive text, not by colour alone.
 * Done items are struck through.
 * Must handle: No items ('No todos'); one item in progress (marked and announced as in progress);
 * a long label wraps; items keep their identity when the agent rewrites the list in another order.
 * Test first: Three items with statuses pending, in_progress and done render three rows with
 * distinct accessible states.
 */

import type { AgentItem } from "@conducted/protocol";
import { CheckCircleIcon, CircleIcon, ClockIcon } from "../../ui/icons.tsx";
import { withKeys } from "./tools/ToolCardFrame.tsx";

export type TodoItems = Extract<AgentItem, { kind: "todo" }>["items"];

export interface TodoListProps {
	items: TodoItems;
}

const STATUS = {
	pending: { word: "pending", Icon: CircleIcon, className: "text-fg-subtle" },
	in_progress: { word: "in progress", Icon: ClockIcon, className: "text-info" },
	done: { word: "done", Icon: CheckCircleIcon, className: "text-success" },
} as const;

export function TodoList({ items }: TodoListProps) {
	if (items.length === 0) {
		return <p className="text-xs text-fg-subtle">No todos</p>;
	}
	return (
		<ul className="flex flex-col gap-1">
			{withKeys(items, (item) => item.label, "todo").map(({ key, item }) => {
				const status = STATUS[item.status];
				const Icon = status.Icon;
				return (
					<li key={key} data-status={item.status} className="flex items-start gap-2 text-sm">
						<Icon className={`mt-0.5 size-4 shrink-0 ${status.className}`} />
						<span
							className={
								item.status === "done"
									? "min-w-0 break-words text-fg-muted line-through"
									: "min-w-0 break-words text-fg"
							}
						>
							{item.label}
						</span>
						<span className="sr-only">{status.word}</span>
					</li>
				);
			})}
		</ul>
	);
}
