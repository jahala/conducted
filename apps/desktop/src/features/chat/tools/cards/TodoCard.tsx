/**
 * @feature CHAT-09 Todo tool card
 * Owns: The card for the agent's todo tool call, drawn with the shared TodoList.
 * Behaviour: ui-map.md 3.3 (Todo: 'No todos', 'Todo started', 'Todo completed'), frontend.md 5
 * (the todo card).
 * Must handle: An empty list ('No todos'); input with no list falls back to the generic card, which
 * still shows the raw name and the output; entries without a label are skipped and an unknown
 * status counts as pending.
 * Test first: A todo call with two items renders two rows through TodoList.
 */
import { ListTodoIcon } from "../../../../ui/icons.tsx";
import { type TodoItems, TodoList } from "../../TodoList.tsx";
import { asRecord, ToolCardFrame, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";
import { GenericToolCard } from "./GenericToolCard.tsx";

const STATUS_KEYS = {
	completed: "done",
	done: "done",
	in_progress: "in_progress",
	"in-progress": "in_progress",
	running: "in_progress",
} as const;

function statusOf(value: unknown): TodoItems[number]["status"] {
	if (typeof value !== "string") return "pending";
	return STATUS_KEYS[value as keyof typeof STATUS_KEYS] ?? "pending";
}

function labelOf(entry: unknown): string | null {
	if (typeof entry === "string") return entry === "" ? null : entry;
	const record = asRecord(entry);
	for (const key of ["content", "label", "text", "subject"]) {
		const value = record[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return null;
}

function entriesFrom(source: unknown[]): TodoItems {
	const items: TodoItems = [];
	for (const entry of source) {
		const label = labelOf(entry);
		if (label === null) continue;
		items.push({ label, status: statusOf(asRecord(entry).status) });
	}
	return items;
}

/** The todo list in the call input, or null when the input carries no list at all. */
function readList(input: unknown): TodoItems | null {
	if (Array.isArray(input)) return entriesFrom(input);
	const record = asRecord(input);
	for (const key of ["todos", "items"]) {
		const value = record[key];
		if (Array.isArray(value)) return entriesFrom(value);
	}
	return null;
}

export function TodoCard(props: ToolCardProps) {
	const items = readList(props.call.item.input);
	if (items === null) {
		return <GenericToolCard {...props} />;
	}
	if (items.length === 0) {
		return (
			<ToolCardFrame
				title="No todos"
				status={toolStatus(props.call)}
				icon={<ListTodoIcon />}
				expandAll={props.defaultExpanded}
			/>
		);
	}
	const done = items.filter((entry) => entry.status === "done").length;
	const title = done === items.length ? "Todo completed" : "Todo started";
	return (
		<ToolCardFrame
			title={title}
			summary={`${done} of ${items.length} done`}
			status={toolStatus(props.call)}
			icon={<ListTodoIcon />}
			expandAll={props.defaultExpanded}
			body={<TodoList items={items} />}
		/>
	);
}
