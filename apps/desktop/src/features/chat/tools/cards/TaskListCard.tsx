/**
 * @feature CHAT-20 Task list card
 * Owns: The card for the agent listing its tasks.
 * Behaviour: ui-map.md 3.3 (Tasks: 'No tasks').
 * Must handle: An empty list ('No tasks'); a long list; a result that is JSON or the agent's text
 * form, and one that carries no task list (its raw text is shown).
 * Test first: A task_list result with no tasks renders 'No tasks'.
 */
import { ToolCardFrame, ToolOutput, toolStatus, withKeys } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";
import { readTasks } from "./TaskGetCard.tsx";

export function TaskListCard({ call, defaultExpanded }: ToolCardProps) {
	const tasks = call.result === null ? null : readTasks(call.result.output);
	const empty = tasks !== null && tasks.length === 0;
	const raw = call.result?.output ?? "";
	const body =
		tasks === null ? (
			raw.length > 0 ? (
				<ToolOutput muted>{raw}</ToolOutput>
			) : (
				<p className="text-xs text-fg-subtle">Loading tasks.</p>
			)
		) : tasks.length === 0 ? null : (
			<ul className="flex max-h-64 flex-col gap-1 overflow-auto">
				{withKeys(tasks, (task) => `${task.id ?? ""}:${task.subject ?? ""}`, "task").map(
					({ key, item: task }) => (
						<li key={key} className="flex items-start gap-2 text-sm">
							<span className="mt-0.5 shrink-0 font-mono text-2xs uppercase text-fg-muted">
								{task.status ?? "—"}
							</span>
							<span className="min-w-0 break-words text-fg">{task.subject ?? task.id ?? ""}</span>
						</li>
					),
				)}
			</ul>
		);
	return (
		<ToolCardFrame
			title={empty ? "No tasks" : "Tasks"}
			summary={
				tasks !== null && tasks.length > 0
					? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`
					: undefined
			}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={body}
		/>
	);
}
