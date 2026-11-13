/**
 * @feature CHAT-20 Background task row
 * Owns: The row a task the agent started in the background shows in the transcript.
 * Behaviour: Conductor's "Background Task" row (main Xft @1420230, renderApp Apa): the label with
 * the task's description in a chip; opened, the description, the call that started it ("Command"
 * for a shell or monitor command, "Script" for a workflow, else "Input" with the call's input) and
 * "Prompt" with the task's prompt (renderApp Tpa).
 * Must handle: a task with nothing more to show (no chevron, nothing opens); a call that is not in
 * the turn (no source); a call with no input.
 * Test first: a background task shows its description and opens to the command that started it.
 */
import type { AgentItem } from "@conducted/protocol";
import { ClockIcon } from "../../ui/icons.tsx";
import { ToolCardFrame, ToolOutput } from "./tools/ToolCardFrame.tsx";

type BackgroundTask = Extract<AgentItem, { kind: "background_task" }>;
type ToolCall = Extract<AgentItem, { kind: "tool_call" }>;

/** What the row shows of the call that started the task, as Conductor's Tpa picks it. */
function sourceOf(call: ToolCall | null): { label: string; text: string } | null {
	if (call === null) return null;
	const input = call.input;
	const record =
		typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	const key =
		call.rawName === "Bash" || call.rawName === "Monitor"
			? "command"
			: call.rawName === "Workflow"
				? "script"
				: null;
	const code = key === null ? undefined : record[key];
	if (typeof code === "string") {
		return { label: call.rawName === "Workflow" ? "Script" : "Command", text: code };
	}
	if (Object.keys(record).length > 0)
		return { label: "Input", text: JSON.stringify(record, null, 2) };
	return null;
}

export function BackgroundTaskRow({
	item,
	source,
}: {
	item: BackgroundTask;
	source: ToolCall | null;
}) {
	const shown = sourceOf(source);
	const opens = item.description !== undefined || item.prompt !== undefined || shown !== null;
	return (
		<ToolCardFrame
			title="Background Task"
			summary={item.description}
			status="done"
			icon={<ClockIcon className="size-3" />}
			body={
				opens ? (
					<div className="flex flex-col gap-2 text-xs">
						{item.description === undefined ? null : <p className="text-fg">{item.description}</p>}
						{shown === null ? null : (
							<div>
								<p className="mb-1 text-fg-muted">{shown.label}</p>
								<ToolOutput>{shown.text}</ToolOutput>
							</div>
						)}
						{item.prompt === undefined ? null : (
							<div>
								<p className="mb-1 text-fg-muted">Prompt</p>
								<p className="whitespace-pre-wrap text-fg">{item.prompt}</p>
							</div>
						)}
					</div>
				) : undefined
			}
		/>
	);
}
