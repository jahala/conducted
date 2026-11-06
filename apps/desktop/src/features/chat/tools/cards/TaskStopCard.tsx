/**
 * @feature CHAT-20 Stop task card
 * Owns: The card for the agent stopping a background task it started.
 * Behaviour: ui-map.md 3.3 ('Stop task').
 * Must handle: A task that had already ended (its result text is shown); a stop that failed (the
 * frame shows Failed); an input that names only the task id.
 * Test first: A task_stop call renders 'Stop task' and the task's name.
 */
import { asRecord, ToolCardFrame, ToolOutput, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function TaskStopCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const name = textField(input, "name", "subject", "description");
	const id = textField(input, "task_id", "taskId", "id");
	const output = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title="Stop task"
			summary={name ?? id ?? undefined}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				output.length > 0 ? (
					<ToolOutput muted>{output}</ToolOutput>
				) : call.result === null ? (
					<p className="text-xs text-fg-subtle">Stopping task.</p>
				) : undefined
			}
		/>
	);
}
