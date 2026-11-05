/**
 * @feature CHAT-08 Slash command card
 * Owns: The card for a slash command the agent ran.
 * Behaviour: ui-map.md 3.3 ('Slash command').
 * Must handle: Arguments shown after the name; a command that failed.
 * Test first: A slash_command call renders the command with its arguments.
 */
import { asRecord, ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SlashCommandCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const command = textField(input, "command", "name", "slash_command") ?? "";
	const args = textField(input, "args", "arguments") ?? "";
	const line = `/${command}${args.length > 0 ? ` ${args}` : ""}`;
	const output = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title="Slash command"
			summary={line}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				output.length > 0 ? (
					<pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-fg-muted">
						{output}
					</pre>
				) : null
			}
		/>
	);
}
