/**
 * @feature CHAT-09 Todo tool card
 * Owns: The card for the agent's todo tool call, drawn with the shared TodoList.
 * Behaviour: ui-map.md 3.3 (Todo: 'No todos', 'Todo started', 'Todo completed'), frontend.md 5
 * (the todo card).
 * Must handle: An empty list ('No todos'); input that is not the neutral todo item shape, an entry
 * with an unknown status or an entry without a label falls back to the generic card, which still
 * shows the raw name and the output.
 * Test first: A todo call with two items renders two rows through TodoList.
 */
import { ListTodoIcon } from "../../../../ui/icons.tsx";
import { type TodoItems, TodoList } from "../../TodoList.tsx";
import { asRecord, ToolCardFrame, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";
import { GenericToolCard } from "./GenericToolCard.tsx";

const STATUSES: readonly string[] = ["pending", "in_progress", "done"];

function isStatus(value: unknown): value is TodoItems[number]["status"] {
	return typeof value === "string" && STATUSES.includes(value);
}

/** One entry of the neutral todo item, or null when its label or status is not the neutral shape. */
function itemFrom(value: unknown): TodoItems[number] | null {
	const record = asRecord(value);
	const label = record.label;
	const status = record.status;
	if (typeof label !== "string" || label === "" || !isStatus(status)) return null;
	return { label, status };
}

/**
 * The neutral todo items in the call input, or null when the input carries no list or an entry the
 * neutral shape cannot describe. The sidecar already turns each runner's todo tool into this shape.
 */
function readList(input: unknown): TodoItems | null {
	const list = Array.isArray(input) ? input : asRecord(input).items;
	if (!Array.isArray(list)) return null;
	const items: TodoItems = [];
	for (const entry of list) {
		const item = itemFrom(entry);
		if (item === null) return null;
		items.push(item);
	}
	return items;
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
