/**
 * @feature CHAT-20 Start monitor card
 * Owns: The card for the agent watching a command's output in the background.
 * Behaviour: ui-map.md 3.3 ('Start monitor').
 * Must handle: A monitor still running; one that ended with an error (the frame shows Failed);
 * the command and the agent's reason for watching it.
 * Test first: A monitor call renders 'Start monitor' and the watched command.
 */
import { ClockIcon } from "../../../../ui/icons.tsx";
import { asRecord, stripAnsi, ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function MonitorCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const command = textField(input, "command", "cmd") ?? "";
	const description = textField(input, "description", "reason");
	const output = stripAnsi(call.result?.output ?? "");
	return (
		<ToolCardFrame
			title="Start monitor"
			summary={command || undefined}
			status={toolStatus(call)}
			icon={<ClockIcon />}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{description ? <p className="text-sm text-fg-muted">{description}</p> : null}
					{command ? (
						<>
							<span className="text-xs font-medium text-fg-subtle">Command:</span>
							<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-surface p-2 font-mono text-xs text-fg-muted">
								{command}
							</pre>
						</>
					) : null}
					{output.length > 0 ? (
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg">
							{output}
						</pre>
					) : null}
				</div>
			}
		/>
	);
}
