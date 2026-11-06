/**
 * @feature CHAT-20 Task update card
 * Owns: The card for the agent changing a task's status, subject or links.
 * Behaviour: ui-map.md 3.3 (Tasks: 'Task details' with Status, Subject, Blocked by, Blocks).
 * Must handle: A change of status only; a change that adds a blocker; fields the input omits are
 * read from the result when it carries the task.
 * Test first: A task_update call that marks a task done shows its subject and the new status.
 */
import { ToolCardFrame, ToolOutput, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";
import {
	hasTaskFields,
	mergeTaskFields,
	readTask,
	TaskFieldsBody,
	taskFieldsFrom,
} from "./TaskGetCard.tsx";

export function TaskUpdateCard({ call, defaultExpanded }: ToolCardProps) {
	const resultFields = call.result === null ? null : readTask(call.result.output);
	const fields = mergeTaskFields(taskFieldsFrom(call.item.input), resultFields);
	const raw = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title="Task details"
			summary={fields.subject ?? fields.id ?? undefined}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				hasTaskFields(fields) ? (
					<TaskFieldsBody fields={fields} />
				) : raw.length > 0 ? (
					<ToolOutput muted>{raw}</ToolOutput>
				) : (
					<p className="text-xs text-fg-subtle">Updating task.</p>
				)
			}
		/>
	);
}
