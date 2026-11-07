/**
 * @feature CHAT-20 Start monitor card
 * Owns: The card for the agent watching a command's output in the background.
 * Behaviour: ui-map.md 3.3 ('Start monitor').
 * Must handle: A monitor still running; one that ended with an error (the frame shows Failed);
 * the command and the agent's reason for watching it.
 * Test first: A monitor call renders 'Start monitor' and the watched command.
 */
import { stripTerminalEscapes } from "../../../../platform/terminal-escapes.ts";
import { asRecord, ToolCardFrame, ToolOutput, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function MonitorCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const command = textField(input, "command", "cmd") ?? "";
	const description = textField(input, "description", "reason");
	const output = stripTerminalEscapes(call.result?.output ?? "");
	return (
		<ToolCardFrame
			title="Start monitor"
			summary={command || undefined}
			status={toolStatus(call)}
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
					{output.length > 0 ? <ToolOutput>{output}</ToolOutput> : null}
				</div>
			}
		/>
	);
}
