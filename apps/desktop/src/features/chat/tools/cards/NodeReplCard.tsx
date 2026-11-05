/**
 * @feature CHAT-20 Node REPL card
 * Owns: The card for JavaScript the agent ran in a Node REPL.
 * Behaviour: ui-map.md 3.3 ('Node REPL').
 * Must handle: Long output (scrolls inside a limited height); an error result (the frame shows
 * Failed); input that is a plain code string instead of an object.
 * Test first: A node_repl call renders 'Node REPL' with the code and its output.
 */
import { TerminalIcon } from "../../../../ui/icons.tsx";
import {
	asRecord,
	formatJson,
	stripAnsi,
	ToolCardFrame,
	ToolOutput,
	textField,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function NodeReplCard({ call, defaultExpanded }: ToolCardProps) {
	const input = call.item.input;
	const code =
		typeof input === "string"
			? input
			: (textField(asRecord(input), "code", "javascript", "script", "js", "input") ??
				formatJson(input));
	const output = stripAnsi(call.result?.output ?? "");
	return (
		<ToolCardFrame
			title="Node REPL"
			status={toolStatus(call)}
			icon={<TerminalIcon />}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<span className="text-xs font-medium text-fg-subtle">Code:</span>
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-surface p-2 font-mono text-xs text-fg-muted">
						{code}
					</pre>
					{output.length > 0 ? (
						<>
							<span className="text-xs font-medium text-fg-subtle">Output:</span>
							<ToolOutput>{output}</ToolOutput>
						</>
					) : null}
					{call.result?.truncated ? (
						<p className="text-xs text-fg-subtle">Output was cut; the start and end are shown.</p>
					) : null}
				</div>
			}
		/>
	);
}
