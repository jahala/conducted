/**
 * @feature CHAT-08 Bash output card
 * Owns: The card for reading the output of a command that runs in the background.
 * Behaviour: frontend.md 5 (registry key 'bash-output'), claude-runner.md 4.
 * Must handle: The command is still running (the output so far); the shell id is unknown (error
 * text from the agent); no new output since the last read.
 * Test first: A bash_output call shows the new output lines.
 */
import { stripTerminalEscapes } from "../../../../platform/terminal-escapes.ts";
import { asRecord, ToolCardFrame, ToolOutput, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function BashOutputCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const shellId = textField(input, "bash_id", "shell_id", "id");
	const output = stripTerminalEscapes(call.result?.output ?? "");
	return (
		<ToolCardFrame
			title="Bash output"
			summary={shellId ?? undefined}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				output.length === 0 ? (
					<p className="text-xs text-fg-subtle">No new output</p>
				) : (
					<ToolOutput>{output}</ToolOutput>
				)
			}
		/>
	);
}
