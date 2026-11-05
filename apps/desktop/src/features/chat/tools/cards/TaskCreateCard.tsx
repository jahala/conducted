/**
 * @feature CHAT-20 Task created card
 * Owns: The card for the agent creating a task in its task list.
 * Behaviour: ui-map.md 3.3 (Tasks: 'Task created').
 * Must handle: A task with no description; a task that blocks or is blocked by others; a result
 * that carries no task (its raw text is shown).
 * Test first: A task_create call renders 'Task created' and the task subject.
 */
import { ListTodoIcon } from "../../../../ui/icons.tsx";
import { ToolCardFrame, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";
import { hasTaskFields, TaskFieldsBody, taskFieldsFrom } from "./TaskGetCard.tsx";

export function TaskCreateCard({ call, defaultExpanded }: ToolCardProps) {
	const fields = taskFieldsFrom(call.item.input);
	const raw = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title="Task created"
			summary={fields.subject ?? fields.id ?? undefined}
			status={toolStatus(call)}
			icon={<ListTodoIcon />}
			expandAll={defaultExpanded}
			body={
				hasTaskFields(fields) ? (
					<TaskFieldsBody fields={fields} />
				) : raw.length > 0 ? (
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg-muted">
						{raw}
					</pre>
				) : (
					<p className="text-xs text-fg-subtle">Creating task.</p>
				)
			}
		/>
	);
}
